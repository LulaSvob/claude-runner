#!/usr/bin/env node
import { Command } from "commander";
import { resolve, dirname } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAll } from "../src/runner/all-runner.js";
import { runEpic } from "../src/runner/epic-runner.js";
import { runStory } from "../src/runner/story-runner.js";
import {
  loadGlobalConfig,
  loadProjectConfig,
  loadEpicConfig,
  resolveStoryConfig,
  type CliOverrides,
} from "../src/config/loader.js";
import { createNotifier } from "../src/notify/ntfy.js";
import { createLogger } from "../src/logging/logger.js";
import * as git from "../src/git/operations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = resolve(__dirname, "..");

const program = new Command();

program
  .name("claude-runner")
  .description("TypeScript epic runner for Claude Code automation")
  .version("0.1.0");

function addGlobalOpts(cmd: Command): Command {
  return cmd
    .option("--project <name>", "Project name (matches projects/<name>/)")
    .option("--model <model>", "Override Claude model")
    .option("--timeout <seconds>", "Override story timeout", parseInt)
    .option("--max-retries <n>", "Override max retries", parseInt)
    .option("--branch <branch>", "Override branch")
    .option("-v, --verbose", "Debug logging")
    .option("-q, --quiet", "Log to file only")
    .option("--dry-run", "Show what would run without executing");
}

function cliOverrides(opts: {
  model?: string;
  timeout?: number;
  maxRetries?: number;
  branch?: string;
}): CliOverrides {
  return {
    model: opts.model,
    maxRetries: opts.maxRetries,
    timeout: opts.timeout,
    branch: opts.branch,
  };
}

function writePidFile(): void {
  try {
    writeFileSync("/tmp/claude-runner.pid", String(process.pid));
  } catch {
    // Non-fatal
  }
}

addGlobalOpts(
  program
    .command("run-all")
    .description("Run all epics for a project")
    .option("--from <n>", "Start from epic N (1-based)", parseInt, 1)
    .option("--to <n>", "End at epic N", parseInt, 99)
    .option("--skip-failed", "Continue past failed epics")
    .option("--include-optional", "Include optional epics (e.g., epic-12)")
).action(async (opts) => {
  if (!opts.project) {
    console.error("Error: --project is required");
    process.exit(1);
  }
  writePidFile();
  const result = await runAll({
    projectName: opts.project,
    runnerRoot: RUNNER_ROOT,
    from: opts.from,
    to: opts.to,
    includeOptional: opts.includeOptional ?? false,
    skipFailed: opts.skipFailed ?? false,
    dryRun: opts.dryRun ?? false,
    cli: cliOverrides(opts),
  });
  process.exit(result.exitCode);
});

addGlobalOpts(
  program
    .command("run-epic <epic-name>")
    .description("Run one epic's stories")
    .option("--start-from <n>", "Resume from story N (1-based)", parseInt, 1)
).action(async (epicName: string, opts) => {
  if (!opts.project) {
    console.error("Error: --project is required");
    process.exit(1);
  }
  writePidFile();

  const global = loadGlobalConfig(RUNNER_ROOT);
  const project = loadProjectConfig(opts.project, RUNNER_ROOT);
  const epicConfig = loadEpicConfig(opts.project, epicName, RUNNER_ROOT);
  const level = opts.verbose ? "debug" : global.logging.level;
  const logger = createLogger(level);
  const storyConfig = resolveStoryConfig(
    global,
    project,
    epicConfig,
    cliOverrides(opts)
  );

  const branchCheck = await git.validateBranch(
    project.project.path,
    storyConfig.branch,
    project.git.protectedBranches
  );
  if (!branchCheck.ok) {
    logger.error(branchCheck.error);
    process.exit(1);
  }

  await git.pullRebase(project.project.path, storyConfig.branch);

  const notifier = createNotifier(storyConfig.notify);
  const logsBaseDir = resolve(RUNNER_ROOT, "logs", opts.project);

  const result = await runEpic(epicConfig, storyConfig, {
    notifier,
    logger,
    logsBaseDir,
    startFrom: opts.startFrom,
    dryRun: opts.dryRun ?? false,
  });

  process.exit(result.exitCode);
});

addGlobalOpts(
  program
    .command("run-story <story-path>")
    .description("Run a single story")
    .option("--no-commit", "Skip git commit/push")
    .option("--no-notify", "Skip notifications")
).action(async (storyPath: string, opts) => {
  if (!opts.project) {
    console.error("Error: --project is required");
    process.exit(1);
  }
  writePidFile();

  const global = loadGlobalConfig(RUNNER_ROOT);
  const project = loadProjectConfig(opts.project, RUNNER_ROOT);

  const epicConfig = {
    epic: { name: "single-story" },
    stories: [storyPath],
  };
  const storyConfig = resolveStoryConfig(
    global,
    project,
    epicConfig,
    cliOverrides(opts)
  );

  if (!opts.commit) {
    storyConfig.git.autoCommit = false;
    storyConfig.git.autoPush = false;
  }

  const level = opts.verbose ? "debug" : global.logging.level;
  const logger = createLogger(level);

  const notifier = opts.notify
    ? createNotifier(storyConfig.notify)
    : createNotifier({ provider: "none", ntfy: storyConfig.notify.ntfy });

  const logsDir = resolve(RUNNER_ROOT, "logs", opts.project, "single-story");

  const outcome = await runStory(storyPath, storyConfig, {
    notifier,
    logger,
    logsDir,
  });

  if (outcome.status === "success") {
    logger.info(`Success (${outcome.durationMs}ms, $${outcome.costUsd.toFixed(2)})`);
    process.exit(0);
  } else if (outcome.status === "failed") {
    logger.error(`Failed: ${outcome.reason}`);
    process.exit(outcome.exitCode);
  }
});

program
  .command("status")
  .description("Show completion status for a project")
  .requiredOption("--project <name>", "Project name")
  .action(async (opts) => {
    const { readdirSync, readFileSync, existsSync } = await import("node:fs");
    const logsDir = resolve(RUNNER_ROOT, "logs", opts.project);

    if (!existsSync(logsDir)) {
      console.log(`No logs found for project: ${opts.project}`);
      return;
    }

    const epicDirs = readdirSync(logsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "run-all" && d.name !== "single-story")
      .map((d) => d.name)
      .sort();

    for (const epic of epicDirs) {
      const completedDir = resolve(logsDir, epic, "completed");
      if (!existsSync(completedDir)) {
        console.log(`\n${epic}: (no completed dir)`);
        continue;
      }
      const doneFiles = readdirSync(completedDir)
        .filter((f) => f.endsWith(".done"))
        .sort();

      console.log(`\n${epic}: ${doneFiles.length} completed`);
      for (const f of doneFiles) {
        const ts = readFileSync(resolve(completedDir, f), "utf-8").trim();
        console.log(`  ✓ ${f.replace(".done", "")} (${ts})`);
      }
    }
  });

program.parse();
