import { resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { runStory as runClaudeSession } from "../sdk/claude-session.js";
import { testAuth } from "../sdk/auth-prober.js";
import { RetryStateMachine } from "../errors/retry-state-machine.js";
import type { ErrorSignal } from "../errors/classifier.js";
import type { ResolvedStoryConfig } from "../config/schema.js";
import type { Notifier } from "../notify/ntfy.js";
import type { Logger } from "../logging/logger.js";
import { LogSink } from "../logging/log-sink.js";
import { Timer } from "../util/timer.js";
import { deriveScope } from "../util/scope.js";
import * as git from "../git/operations.js";
import type { StoryOutcome } from "./types.js";

const execFile = promisify(execFileCb);

async function logFailureDiagnostics(
  logger: Logger,
  logsDir: string,
  storyName: string,
): Promise<void> {
  logger.info("Diagnostics:");
  logger.info(`  wall-clock: ${new Date().toISOString()}`);

  try {
    const { stdout } = await execFile("claude", ["--version"]);
    logger.info(`  claude version: ${stdout.trim()}`);
  } catch {
    logger.info("  claude version: <failed>");
  }

  const debugPath = resolve(logsDir, `${storyName}.debug.log`);
  if (existsSync(debugPath)) {
    try {
      const st = statSync(debugPath);
      logger.info(`  debug log: ${debugPath} (${st.size} bytes)`);
    } catch {}
  }

  const logPath = resolve(logsDir, `${storyName}.log`);
  if (existsSync(logPath)) {
    try {
      const content = readFileSync(logPath, "utf-8");
      const lines = content.trimEnd().split("\n");
      const lineCount = lines.length;
      const st = statSync(logPath);
      logger.info(`  log file: ${lineCount} lines / ${st.size} bytes`);
      logger.info("  last 5 lines:");
      for (const line of lines.slice(-5)) {
        logger.info(`    | ${line}`);
      }
    } catch {}
  }
}

interface ResumableWaiter {
  wait(ms: number): Promise<void>;
  dispose(): void;
}

function createResumableWaiter(
  sentinelPath: string
): ResumableWaiter {
  let resolver: (() => void) | null = null;
  let timer: NodeJS.Timeout | null = null;
  let watcher: ReturnType<typeof import("node:fs").watch> | null = null;

  const onSignal = () => resolver?.();

  process.on("SIGUSR1", onSignal);

  return {
    async wait(ms: number): Promise<void> {
      return new Promise<void>((res) => {
        resolver = res;
        timer = setTimeout(res, ms);

        try {
          const { watch } = require("node:fs") as typeof import("node:fs");
          const { dirname } = require("node:path") as typeof import("node:path");
          const dir = dirname(sentinelPath);
          mkdirSync(dir, { recursive: true });
          watcher = watch(dir, (_, filename) => {
            if (
              filename === require("node:path").basename(sentinelPath) &&
              existsSync(sentinelPath)
            ) {
              const { unlinkSync } = require("node:fs") as typeof import("node:fs");
              try { unlinkSync(sentinelPath); } catch {}
              res();
            }
          });
        } catch {
          // fs.watch not available — fall back to timeout only
        }
      }).finally(() => {
        if (timer) clearTimeout(timer);
        if (watcher) watcher.close();
        watcher = null;
        timer = null;
        resolver = null;
      });
    },
    dispose() {
      process.removeListener("SIGUSR1", onSignal);
      if (watcher) watcher.close();
      if (timer) clearTimeout(timer);
    },
  };
}

export async function runStory(
  storyPath: string,
  config: ResolvedStoryConfig,
  deps: {
    notifier: Notifier;
    logger: Logger;
    logsDir: string;
  }
): Promise<StoryOutcome> {
  const { logger, notifier, logsDir } = deps;
  const storyName = storyPath.replace(/\.md$/, "").split("/").pop()!;
  const scope = deriveScope(storyName);
  const timer = new Timer();

  const rsm = new RetryStateMachine({
    maxRetries: config.maxRetries,
    quotaMaxWaits: config.quotaMaxWaits,
    quotaWaitSeconds: config.quotaWaitSeconds,
  });

  const waiter = createResumableWaiter(config.resumeSentinel);

  try {
    while (true) {
      const state = rsm.getState();
      logger.info(
        `Starting: ${storyName} (attempt ${state.attempt}/${config.maxRetries})`
      );

      const dirty = await git.cleanWorkingTree(config.projectPath);
      if (dirty > 0) {
        logger.info(`Cleaned ${dirty} dirty files`);
      }

      await git.forceBranch(config.projectPath, config.branch);

      mkdirSync(logsDir, { recursive: true });

      const sink = new LogSink(logsDir, storyName);
      const attemptTimer = new Timer();

      const sessionResult = await runClaudeSession(storyPath, config, {
        onEvent: (event) => {
          if (event.kind === "text") {
            sink.write(event.text);
            process.stdout.write(event.text);
          }
          if (event.kind === "error") {
            logger.warn({ signal: event.signal }, "Stream error detected");
          }
        },
        onStall: (info) => {
          logger.warn(
            `Stream stall: no messages for ${Math.round(info.stallMs / 1000)}s (stall #${info.totalStalls}). ` +
            `Will abort at ${config.streamStallTimeoutSeconds}s.`
          );
        },
        logsDir,
        storyName,
      });

      sink.close();
      await git.forceBranch(config.projectPath, config.branch);

      if (sessionResult.success) {
        logger.info(
          `Claude completed successfully (${attemptTimer.format()}, $${sessionResult.costUsd.toFixed(2)})`
        );

        if (await git.hasChanges(config.projectPath)) {
          if (config.git.autoCommit) {
            try {
              await git.commitAndPush(config.projectPath, config.branch, {
                scope,
                storyName,
                commitTemplate: config.git.commitTemplate,
                coAuthor: config.git.coAuthor,
              });
              logger.info(`Committed and pushed: ${storyName}`);
            } catch (err) {
              logger.error(
                `Commit/push failed: ${err instanceof Error ? err.message : err}`
              );
              const action = rsm.handleNormalFailure();
              if (action.action === "abort") {
                return {
                  status: "failed",
                  exitCode: action.exitCode,
                  reason: `Commit/push failed: ${err instanceof Error ? err.message : "unknown"}`,
                  durationMs: timer.elapsedMs(),
                };
              }
              continue;
            }
          }
        } else {
          logger.info(`No changes produced for: ${storyName}`);
        }

        return {
          status: "success",
          durationMs: timer.elapsedMs(),
          costUsd: sessionResult.costUsd,
        };
      }

      if (sessionResult.stalledOut) {
        const { streamStats } = sessionResult;
        logger.error(
          `STREAM STALL ABORT: ${storyName} — no SDK messages for ${config.streamStallTimeoutSeconds}s. ` +
          `Messages received: ${streamStats.messagesReceived}, ` +
          `total stalls: ${streamStats.totalStalls}, ` +
          `longest stall: ${Math.round(streamStats.longestStallMs / 1000)}s`
        );
        await notifier.notifyStory({
          title: "Stream stall — retrying",
          message: `${storyName} — no messages for ${config.streamStallTimeoutSeconds}s ` +
            `(${streamStats.messagesReceived} msgs received before stall)`,
          priority: "high",
          tags: "warning",
        });
      }

      if (sessionResult.timedOut) {
        logger.error(
          `TIMEOUT: ${storyName} exceeded ${config.storyTimeoutSeconds}s`
        );
      }

      if (sessionResult.streamStats.messagesReceived > 0) {
        logger.info(
          `Stream stats: ${sessionResult.streamStats.messagesReceived} messages, ` +
          `${sessionResult.streamStats.totalStalls} stalls, ` +
          `longest stall: ${Math.round(sessionResult.streamStats.longestStallMs / 1000)}s`
        );
      }

      await logFailureDiagnostics(logger, logsDir, storyName);

      const errorSignal: ErrorSignal | null = sessionResult.errorSignal;

      if (errorSignal) {
        const action = rsm.decide(errorSignal);

        if (action.action === "abort") {
          logger.error(`ABORT: ${action.reason}`);
          await notifier.notifyStory({
            title: "Story aborted",
            message: `${storyName} — ${action.reason}`,
            priority: "urgent",
            tags: "rotating_light",
          });
          return {
            status: "failed",
            exitCode: action.exitCode,
            reason: action.reason,
            durationMs: timer.elapsedMs(),
          };
        }

        if (action.action === "quota_wait") {
          const waitMins = Math.ceil(action.sleepMs / 60_000);
          const rsmState = rsm.getState();
          logger.info(
            `Quota/rate limit detected. Sleeping ~${waitMins}m (wait ${rsmState.quotaWaits}/${config.quotaMaxWaits})...`
          );
          await notifier.notifyStory({
            title: "Quota hit — waiting",
            message: `${storyName} — sleeping ${waitMins}m (wait ${rsmState.quotaWaits}/${config.quotaMaxWaits})`,
            tags: "hourglass_flowing_sand",
          });
          await waiter.wait(action.sleepMs);
          logger.info("Quota sleep over. Retrying...");
          continue;
        }

        if (action.action === "auth_wait") {
          logger.warn(
            "AUTH CHECK FAILED. Run 'claude login' — runner will auto-resume."
          );
          await notifier.notifyStory({
            title: "Auth broken — runner paused",
            message: `${storyName} — run 'claude login' to resume`,
            priority: "urgent",
            tags: "key",
          });

          while (true) {
            const probe = await testAuth(config.model);
            if (probe.ok) break;
            logger.info(`Auth probe: ${probe.reason} — ${probe.message}`);
            await waiter.wait(config.authPollIntervalSeconds * 1000);
          }

          logger.info("Auth restored. Retrying...");
          await notifier.notifyStory({
            title: "Auth restored — resuming",
            message: storyName,
            tags: "white_check_mark",
          });
          continue;
        }
      }

      const action = rsm.handleNormalFailure();

      if (action.action === "abort") {
        logger.error(`FAILED: ${action.reason}`);
        await notifier.notifyStory({
          title: "Story failed",
          message: `${storyName} — ${action.reason}`,
          priority: "high",
          tags: "x",
        });
        await git.cleanWorkingTree(config.projectPath);
        return {
          status: "failed",
          exitCode: action.exitCode,
          reason: action.reason,
          durationMs: timer.elapsedMs(),
        };
      }

      if (action.action === "quota_wait") {
        const delaySecs = Math.ceil(action.sleepMs / 1000);
        const rsmState = rsm.getState();
        logger.info(
          `Retrying in ${delaySecs}s (attempt ${rsmState.attempt}/${config.maxRetries})...`
        );
        await notifier.notifyStory({
          title: "Retrying story",
          message: `${storyName} — attempt ${rsmState.attempt}/${config.maxRetries}`,
          tags: "repeat",
        });
        await waiter.wait(action.sleepMs);
      }
    }
  } finally {
    waiter.dispose();
  }
}
