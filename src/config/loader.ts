import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  globalConfigSchema,
  projectConfigSchema,
  epicConfigSchema,
  runAllConfigSchema,
  type GlobalConfig,
  type ProjectConfig,
  type EpicConfig,
  type RunAllConfig,
  type ResolvedStoryConfig,
} from "./schema.js";

function findRunnerRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  while (dir !== "/") {
    if (existsSync(resolve(dir, "config.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    "Cannot find claude-runner root (no config.yaml found in parent dirs)"
  );
}

function loadYaml(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }
  return parseYaml(readFileSync(path, "utf-8"));
}

export function loadGlobalConfig(runnerRoot?: string): GlobalConfig {
  const root = runnerRoot ?? findRunnerRoot();
  const raw = loadYaml(resolve(root, "config.yaml"));
  return globalConfigSchema.parse(raw);
}

export function loadProjectConfig(
  projectName: string,
  runnerRoot?: string
): ProjectConfig {
  const root = runnerRoot ?? findRunnerRoot();
  const path = resolve(root, "projects", projectName, "project.yaml");
  const raw = loadYaml(path);
  return projectConfigSchema.parse(raw);
}

export function loadEpicConfig(
  projectName: string,
  epicName: string,
  runnerRoot?: string
): EpicConfig {
  const root = runnerRoot ?? findRunnerRoot();
  const path = resolve(root, "projects", projectName, `${epicName}.yaml`);
  const raw = loadYaml(path);
  return epicConfigSchema.parse(raw);
}

export function loadRunAllConfig(
  projectName: string,
  runnerRoot?: string
): RunAllConfig {
  const root = runnerRoot ?? findRunnerRoot();
  const path = resolve(root, "projects", projectName, "run-all.yaml");
  const raw = loadYaml(path);
  return runAllConfigSchema.parse(raw);
}

export interface CliOverrides {
  model?: string;
  maxRetries?: number;
  timeout?: number;
  branch?: string;
}

export function resolveStoryConfig(
  global: GlobalConfig,
  project: ProjectConfig,
  epic: EpicConfig,
  cli: CliOverrides = {}
): ResolvedStoryConfig {
  const projectDefaults = project.defaults ?? {};

  return {
    model:
      cli.model ??
      projectDefaults.model ??
      global.defaults.model,
    maxRetries:
      cli.maxRetries ??
      epic.maxRetries ??
      projectDefaults.maxRetries ??
      global.defaults.maxRetries,
    storyTimeoutSeconds:
      cli.timeout ??
      epic.storyTimeoutSeconds ??
      projectDefaults.storyTimeoutSeconds ??
      global.defaults.storyTimeoutSeconds,
    streamStallTimeoutSeconds:
      epic.streamStallTimeoutSeconds ??
      projectDefaults.streamStallTimeoutSeconds ??
      global.defaults.streamStallTimeoutSeconds,
    maxBudgetUsd:
      projectDefaults.maxBudgetUsd ?? global.defaults.maxBudgetUsd,
    quotaWaitSeconds:
      projectDefaults.quotaWaitSeconds ?? global.defaults.quotaWaitSeconds,
    quotaMaxWaits:
      projectDefaults.quotaMaxWaits ?? global.defaults.quotaMaxWaits,
    authPollIntervalSeconds:
      projectDefaults.authPollIntervalSeconds ??
      global.defaults.authPollIntervalSeconds,
    memoryGuardRssMb:
      projectDefaults.memoryGuardRssMb ?? global.defaults.memoryGuardRssMb,
    memoryGuardCheckIntervalSeconds:
      projectDefaults.memoryGuardCheckIntervalSeconds ??
      global.defaults.memoryGuardCheckIntervalSeconds,
    projectPath: project.project.path,
    branch: cli.branch ?? epic.branch ?? project.project.branch,
    promptTemplate: project.promptTemplate,
    git: project.git,
    notify: {
      provider: global.notify.provider,
      ntfy: {
        ...global.notify.ntfy,
        ...project.notify?.ntfy,
      },
    },
    logging: global.logging,
    resumeSentinel: global.resumeSentinel,
  };
}
