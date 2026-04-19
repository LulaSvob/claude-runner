import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  loadGlobalConfig,
  loadProjectConfig,
  loadEpicConfig,
  loadRunAllConfig,
  resolveStoryConfig,
} from "../src/config/loader.js";

const RUNNER_ROOT = resolve(import.meta.dirname, "..");

describe("config loader", () => {
  it("loads global config.yaml with defaults", () => {
    const config = loadGlobalConfig(RUNNER_ROOT);
    expect(config.defaults.model).toBe("claude-opus-4-6[1m]");
    expect(config.defaults.maxRetries).toBe(2);
    expect(config.defaults.storyTimeoutSeconds).toBe(2700);
    expect(config.notify.provider).toBe("ntfy");
    expect(config.logging.level).toBe("info");
    expect(config.resumeSentinel).toBe("/tmp/claude-runner-resume");
  });

  it("loads slotforge project config", () => {
    const config = loadProjectConfig("slotforge", RUNNER_ROOT);
    expect(config.project.name).toBe("slotforge");
    expect(config.project.path).toBe("/home/lubo/projects/slotforge");
    expect(config.project.branch).toBe("develop");
    expect(config.promptTemplate).toBe("/flow @{storyPath}");
    expect(config.git.autoCommit).toBe(true);
  });

  it("loads epic config with stories", () => {
    const config = loadEpicConfig(
      "slotforge",
      "epic-01-foundation",
      RUNNER_ROOT
    );
    expect(config.epic.name).toBe("epic-01-foundation");
    expect(config.stories.length).toBeGreaterThan(0);
    expect(config.stories[0]).toContain("us-1.1");
  });

  it("loads run-all config", () => {
    const config = loadRunAllConfig("slotforge", RUNNER_ROOT);
    expect(config.epicOrder.length).toBeGreaterThan(0);
    expect(config.epicOrder[0]).toBe("epic-01-foundation");
    expect(config.skipFailed).toBe(false);
  });

  it("resolves story config with merge chain", () => {
    const global = loadGlobalConfig(RUNNER_ROOT);
    const project = loadProjectConfig("slotforge", RUNNER_ROOT);
    const epic = loadEpicConfig(
      "slotforge",
      "epic-01-foundation",
      RUNNER_ROOT
    );

    const resolved = resolveStoryConfig(global, project, epic);
    expect(resolved.model).toBe("claude-opus-4-6[1m]");
    expect(resolved.maxRetries).toBe(2);
    expect(resolved.projectPath).toBe("/home/lubo/projects/slotforge");
    expect(resolved.branch).toBe("develop");
    expect(resolved.promptTemplate).toBe("/flow @{storyPath}");
    expect(resolved.git.autoCommit).toBe(true);
  });

  it("CLI overrides take precedence", () => {
    const global = loadGlobalConfig(RUNNER_ROOT);
    const project = loadProjectConfig("slotforge", RUNNER_ROOT);
    const epic = loadEpicConfig(
      "slotforge",
      "epic-01-foundation",
      RUNNER_ROOT
    );

    const resolved = resolveStoryConfig(global, project, epic, {
      model: "claude-sonnet-4-6",
      maxRetries: 5,
      timeout: 1800,
      branch: "feature/test",
    });

    expect(resolved.model).toBe("claude-sonnet-4-6");
    expect(resolved.maxRetries).toBe(5);
    expect(resolved.storyTimeoutSeconds).toBe(1800);
    expect(resolved.branch).toBe("feature/test");
  });

  it("throws for missing config files", () => {
    expect(() => loadProjectConfig("nonexistent", RUNNER_ROOT)).toThrow(
      "Config file not found"
    );
  });
});
