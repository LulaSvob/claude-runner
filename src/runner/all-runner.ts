import { resolve } from "node:path";
import { runEpic } from "./epic-runner.js";
import {
  loadGlobalConfig,
  loadProjectConfig,
  loadEpicConfig,
  loadRunAllConfig,
  resolveStoryConfig,
  type CliOverrides,
} from "../config/loader.js";
import { createNotifier } from "../notify/ntfy.js";
import { createLogger } from "../logging/logger.js";
import * as git from "../git/operations.js";
import { Timer } from "../util/timer.js";
import type { RunAllResult } from "./types.js";

export async function runAll(opts: {
  projectName: string;
  runnerRoot: string;
  from: number;
  to: number;
  skipFailed: boolean;
  dryRun: boolean;
  cli: CliOverrides;
}): Promise<RunAllResult> {
  const global = loadGlobalConfig(opts.runnerRoot);
  const project = loadProjectConfig(opts.projectName, opts.runnerRoot);
  const runAllConfig = loadRunAllConfig(opts.projectName, opts.runnerRoot);
  const logger = createLogger(global.logging.level);
  const timer = new Timer();

  const notifier = createNotifier({
    provider: global.notify.provider,
    ntfy: {
      ...global.notify.ntfy,
      ...project.notify?.ntfy,
    },
  });

  const branchCheck = await git.validateBranch(
    project.project.path,
    project.project.branch,
    project.git.protectedBranches
  );
  if (!branchCheck.ok) {
    logger.error(branchCheck.error);
    process.exit(1);
  }

  const epics = runAllConfig.epicOrder.filter((_, i) => {
    const n = i + 1;
    return n >= opts.from && n <= opts.to;
  });

  const logsBaseDir = resolve(opts.runnerRoot, "logs", opts.projectName);
  let epicsOk = 0;
  let epicsFailed = 0;

  logger.info("═".repeat(50));
  logger.info(`Run-All: ${opts.projectName}`);
  logger.info(`Epics: ${epics.length} (${opts.from}–${opts.to})`);
  logger.info("═".repeat(50));

  await notifier.notifyRunAll({
    title: "Run-all started",
    message: `${opts.projectName}: ${epics.length} epics`,
    tags: "rocket",
  });

  for (const epicName of epics) {
    logger.info(`\nStarting epic: ${epicName}`);
    await notifier.notifyRunAll({
      title: "Epic starting",
      message: epicName,
      tags: "hourglass",
    });

    const epicConfig = loadEpicConfig(
      opts.projectName,
      epicName,
      opts.runnerRoot
    );
    const storyConfig = resolveStoryConfig(
      global,
      project,
      epicConfig,
      opts.cli
    );

    const result = await runEpic(epicConfig, storyConfig, {
      notifier,
      logger,
      logsBaseDir,
      startFrom: 1,
      dryRun: opts.dryRun,
    });

    if (result.exitCode === 0) {
      epicsOk++;
      await notifier.notifyRunAll({
        title: "Epic done",
        message: `${epicName} — ${result.completed} stories (${result.durationMs}ms)`,
        tags: "white_check_mark",
      });
    } else if (result.exitCode === 2) {
      epicsFailed++;
      logger.error(`Epic ${epicName} hit quota/API cap — stopping run`);
      await notifier.notifyRunAll({
        title: "Quota cap — run halted",
        message: `${epicName} — quota/API errors, halting`,
        priority: "urgent",
        tags: "rotating_light",
      });
      break;
    } else {
      epicsFailed++;
      await notifier.notifyRunAll({
        title: "Epic failed",
        message: `${epicName} — ${result.failed} failures`,
        priority: "high",
        tags: "x",
      });
      if (!opts.skipFailed && !runAllConfig.skipFailed) {
        break;
      }
    }
  }

  logger.info("═".repeat(50));
  logger.info(
    `Run-all summary: ${epicsOk} OK, ${epicsFailed} FAILED (${timer.format()})`
  );
  logger.info("═".repeat(50));

  await notifier.notifyRunAll({
    title: epicsFailed === 0 ? "Run-all complete" : "Run-all finished",
    message: `${epicsOk} OK, ${epicsFailed} failed (${timer.format()})`,
    priority: epicsFailed > 0 ? "high" : "default",
    tags: epicsFailed === 0 ? "tada" : "warning",
  });

  return {
    epicsOk,
    epicsFailed,
    durationMs: timer.elapsedMs(),
    exitCode: epicsFailed > 0 ? 1 : 0,
  };
}
