import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasCommitForStory } from "./operations.js";

export type SkipReason = "done-marker" | "git-history" | "before-start";

export async function shouldSkipStory(
  storyName: string,
  opts: {
    completedDir: string;
    projectPath: string;
    stepIndex: number;
    startFrom: number;
  }
): Promise<{ skip: boolean; reason?: SkipReason }> {
  if (opts.stepIndex < opts.startFrom) {
    return { skip: true, reason: "before-start" };
  }

  const donePath = resolve(opts.completedDir, `${storyName}.done`);
  if (existsSync(donePath)) {
    return { skip: true, reason: "done-marker" };
  }

  if (await hasCommitForStory(opts.projectPath, storyName)) {
    return { skip: true, reason: "git-history" };
  }

  return { skip: false };
}

export function markDone(completedDir: string, storyName: string): void {
  const donePath = resolve(completedDir, `${storyName}.done`);
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(completedDir, { recursive: true });
  writeFileSync(donePath, new Date().toISOString() + "\n");
}

export function getDoneTimestamp(
  completedDir: string,
  storyName: string
): string | null {
  const donePath = resolve(completedDir, `${storyName}.done`);
  if (!existsSync(donePath)) return null;
  return readFileSync(donePath, "utf-8").trim();
}
