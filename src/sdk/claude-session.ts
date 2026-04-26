import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { StreamMonitor, type StreamEvent } from "./stream-monitor.js";
import type { ErrorSignal } from "../errors/classifier.js";
import type { ResolvedStoryConfig } from "../config/schema.js";
import { resolve } from "node:path";
import {
  findSdkChildPid,
  getRssBytesForTree,
  killProcessTree,
} from "../util/process-tree.js";

const RUNNER_DISCIPLINE_PROMPT = `

IMPORTANT — RUNNER DISCIPLINE (must follow):
- Never invoke Bash with run_in_background=true for tests, builds, type-checks, native compilation, or any other long-running command. Background tasks bypass the tool's timeout argument and can hang indefinitely, pinning the WSL host. Run such commands in the foreground with an explicit \`timeout\` argument and read the result before issuing the next tool call.
- Do not queue more shell tool calls while a previous heavy subprocess (vitest, native sandbox tests, isolated-vm work, type-check) might still be running. If the previous tool result has not returned, wait or abort — never fan out parallel heavy shells.
- For tests that exercise memory limits or sandbox isolation, run a single test file at a time with a tight \`timeout\` (e.g. 60–120 s). If the run exceeds the timeout, treat that as a failure and investigate the test, not as something to retry blindly.
`;

export interface SessionResult {
  success: boolean;
  costUsd: number;
  result: string;
  errorSignal: ErrorSignal | null;
  timedOut: boolean;
  stalledOut: boolean;
  memoryExceeded: boolean;
  memoryRssBytes: number;
  streamStats: StreamStats;
}

export interface StreamStats {
  messagesReceived: number;
  firstMessageAt: number | null;
  lastMessageAt: number | null;
  totalStalls: number;
  longestStallMs: number;
}

function abortSession(
  abortController: AbortController,
  q: Query | null,
): void {
  abortController.abort();
  if (q) {
    q.interrupt().catch(() => {});
  }
}

export async function runStory(
  storyPath: string,
  config: ResolvedStoryConfig,
  opts: {
    onEvent: (event: StreamEvent) => void;
    onStall?: (info: { stallMs: number; totalStalls: number }) => void;
    onOrphanCleanup?: (killed: number) => void;
    onSuspectSleep?: (info: { expectedMs: number; actualMs: number }) => void;
    retryContext?: string | null;
    logsDir: string;
    storyName: string;
  }
): Promise<SessionResult> {
  const basePrompt = config.promptTemplate.replace("{storyPath}", storyPath);
  const prompt =
    basePrompt + RUNNER_DISCIPLINE_PROMPT + (opts.retryContext ?? "");
  const abortController = new AbortController();

  let q: Query | null = null;
  let stalledOut = false;
  let memoryExceeded = false;
  let memoryRssBytes = 0;

  const stats: StreamStats = {
    messagesReceived: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    totalStalls: 0,
    longestStallMs: 0,
  };

  const stallThresholdMs = config.streamStallTimeoutSeconds * 1000;
  const stallWarningMs = Math.min(stallThresholdMs * 0.5, 120_000);
  let stallTimer: NodeJS.Timeout | null = null;
  let stallWarningTimer: NodeJS.Timeout | null = null;
  let lastMsgTime = Date.now();
  let awaitingToolResult = false;

  function resetStallTimers(): void {
    const now = Date.now();
    const gap = now - lastMsgTime;
    if (stats.messagesReceived > 0 && gap > stallWarningMs) {
      stats.totalStalls++;
      if (gap > stats.longestStallMs) stats.longestStallMs = gap;
    }
    lastMsgTime = now;
    stats.lastMessageAt = now;
    if (stats.firstMessageAt === null) stats.firstMessageAt = now;

    if (stallTimer) clearTimeout(stallTimer);
    if (stallWarningTimer) clearTimeout(stallWarningTimer);

    // Don't arm stall timers while waiting for a tool to finish —
    // silence is expected during long-running bash commands.
    if (awaitingToolResult) return;

    stallWarningTimer = setTimeout(() => {
      const elapsed = Date.now() - lastMsgTime;
      opts.onStall?.({
        stallMs: elapsed,
        totalStalls: stats.totalStalls + 1,
      });
    }, stallWarningMs);

    stallTimer = setTimeout(() => {
      stalledOut = true;
      abortSession(abortController, q);
      killTimer = setTimeout(() => {
        if (q) q.close();
      }, KILL_GRACE_MS);
    }, stallThresholdMs);
  }

  function detectToolExecution(msg: SDKMessage): void {
    if (
      msg.type === "assistant" &&
      msg.message?.content?.some(
        (b: { type: string }) => b.type === "tool_use",
      )
    ) {
      awaitingToolResult = true;
    } else if (awaitingToolResult && msg.type !== "assistant") {
      // Any non-assistant message after tool_use means tool has returned
      awaitingToolResult = false;
    }
  }

  // WSL/system sleep detection: a 30s heartbeat that checks for clock jumps.
  // If the timer fires and the actual elapsed time is >2x expected, the system
  // was likely suspended (WSL sleep, laptop lid close, etc.).
  const HEARTBEAT_MS = 30_000;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let lastHeartbeat = Date.now();

  function startHeartbeat(): void {
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastHeartbeat;
      if (elapsed > HEARTBEAT_MS * 3) {
        opts.onSuspectSleep?.({
          expectedMs: HEARTBEAT_MS,
          actualMs: elapsed,
        });
      }
      lastHeartbeat = now;
    }, HEARTBEAT_MS);
  }

  let killTimer: NodeJS.Timeout | null = null;
  const KILL_GRACE_MS = 30_000;

  // Memory guard: poll the SDK child's process tree RSS and abort if it
  // exceeds the configured limit. Catches runaway native subprocesses
  // (e.g. isolated-vm tests allocating until WSL freezes).
  const memoryLimitBytes = config.memoryGuardRssMb * 1024 * 1024;
  const memoryCheckMs = config.memoryGuardCheckIntervalSeconds * 1000;
  let memoryGuardTimer: NodeJS.Timeout | null = null;
  let memoryGuardSdkPid: number | null = null;

  const timeoutHandle = setTimeout(() => {
    abortSession(abortController, q);
    // If interrupt doesn't kill the process within the grace period,
    // escalate to close() which does SIGTERM → SIGKILL.
    killTimer = setTimeout(() => {
      if (q) q.close();
    }, KILL_GRACE_MS);
  }, config.storyTimeoutSeconds * 1000);

  const monitor = new StreamMonitor(opts.onEvent);
  let errorSignal: ErrorSignal | null = null;
  let costUsd = 0;
  let result = "";

  function clearAllTimers(): void {
    if (stallTimer) clearTimeout(stallTimer);
    if (stallWarningTimer) clearTimeout(stallWarningTimer);
    if (killTimer) clearTimeout(killTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (memoryGuardTimer) clearInterval(memoryGuardTimer);
  }

  function startMemoryGuard(debugFile: string | undefined): void {
    if (!debugFile) return;
    memoryGuardTimer = setInterval(() => {
      void (async () => {
        if (memoryGuardSdkPid === null) {
          memoryGuardSdkPid = await findSdkChildPid(debugFile);
          if (memoryGuardSdkPid === null) return;
        }
        const rss = await getRssBytesForTree(memoryGuardSdkPid);
        if (rss === 0) {
          // Process tree gone — let normal teardown finish.
          return;
        }
        if (rss > memoryLimitBytes) {
          memoryExceeded = true;
          memoryRssBytes = rss;
          abortSession(abortController, q);
          if (!killTimer) {
            killTimer = setTimeout(() => {
              if (q) q.close();
            }, KILL_GRACE_MS);
          }
        } else if (rss > memoryRssBytes) {
          memoryRssBytes = rss;
        }
      })();
    }, memoryCheckMs);
  }

  const debugFilePath = config.logging.sdkDebug
    ? resolve(opts.logsDir, `${opts.storyName}.debug.log`)
    : undefined;

  try {
    q = query({
      prompt,
      options: {
        cwd: config.projectPath,
        model: config.model,
        maxBudgetUsd: config.maxBudgetUsd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController,
        ...(debugFilePath ? { debugFile: debugFilePath } : {}),
      },
    });

    resetStallTimers();
    startHeartbeat();
    startMemoryGuard(debugFilePath);

    for await (const msg of q) {
      stats.messagesReceived++;
      detectToolExecution(msg);
      resetStallTimers();

      const signal = monitor.process(msg);

      if (signal && signal.type === "quota") {
        errorSignal = signal;
        await q.interrupt();
        break;
      }

      if (signal && signal.type === "auth") {
        errorSignal = signal;
        await q.interrupt();
        break;
      }

      if (signal && signal.type === "budget_exceeded") {
        errorSignal = signal;
        break;
      }

      if (
        signal &&
        (signal.type === "api_error" || signal.type === "server_error")
      ) {
        errorSignal = signal;
      }

      if (msg.type === "result") {
        costUsd = msg.total_cost_usd;
        if (msg.subtype === "success") {
          result = msg.result;
        }
      }
    }

    const timedOut =
      abortController.signal.aborted && !stalledOut && !memoryExceeded;

    return {
      success:
        errorSignal === null &&
        !timedOut &&
        !stalledOut &&
        !memoryExceeded &&
        result !== "",
      costUsd,
      result,
      errorSignal,
      timedOut,
      stalledOut,
      memoryExceeded,
      memoryRssBytes,
      streamStats: stats,
    };
  } catch (err: unknown) {
    const aborted = abortController.signal.aborted;
    const isAbort =
      aborted ||
      (err instanceof Error && err.message.includes("aborted"));

    if (isAbort) {
      return {
        success: false,
        costUsd,
        result,
        errorSignal,
        timedOut: aborted && !stalledOut && !memoryExceeded,
        stalledOut,
        memoryExceeded,
        memoryRssBytes,
        streamStats: stats,
      };
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      costUsd,
      result,
      errorSignal: { type: "server_error" as const, message: errMsg },
      timedOut: false,
      stalledOut: false,
      memoryExceeded: false,
      memoryRssBytes,
      streamStats: stats,
    };
  } finally {
    clearTimeout(timeoutHandle);
    clearAllTimers();

    // Kill any orphaned process tree left behind by the SDK.
    // The SDK only kills its direct child; grandchildren (bash → vitest → workers) survive.
    if (debugFilePath) {
      const sdkPid = await findSdkChildPid(debugFilePath);
      if (sdkPid) {
        const killed = await killProcessTree(sdkPid);
        if (killed > 0) {
          opts.onOrphanCleanup?.(killed);
        }
      }
    }
  }
}
