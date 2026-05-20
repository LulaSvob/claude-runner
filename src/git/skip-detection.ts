import { existsSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { hasCommitForStory } from "./operations.js";

export type SkipReason = "story-done" | "story-fixed" | "git-history" | "before-start";

function readStoryStatus(storyFilePath: string): string | null {
  if (!existsSync(storyFilePath)) return null;
  const content = readFileSync(storyFilePath, "utf-8");
  const match = /^\*\*Status:\*\*\s*(.+)$/m.exec(content);
  return match?.[1]?.trim() ?? null;
}

function statusMatches(status: string, keyword: string): boolean {
  return status.toLowerCase().includes(keyword.toLowerCase());
}

export function isStoryDone(storyFilePath: string): boolean {
  const status = readStoryStatus(storyFilePath);
  if (!status) return false;
  return statusMatches(status, "done") || statusMatches(status, "fixed");
}

export async function shouldSkipStory(
  storyRelativePath: string,
  opts: {
    projectPath: string;
    stepIndex: number;
    startFrom: number;
  }
): Promise<{ skip: boolean; reason?: SkipReason }> {
  if (opts.stepIndex < opts.startFrom) {
    return { skip: true, reason: "before-start" };
  }

  const storyFilePath = resolve(opts.projectPath, storyRelativePath);
  const status = readStoryStatus(storyFilePath);

  if (status && statusMatches(status, "done")) {
    return { skip: true, reason: "story-done" };
  }
  if (status && statusMatches(status, "fixed")) {
    return { skip: true, reason: "story-fixed" };
  }

  // Fallback: check git history for stories that were implemented
  // but never formally accepted (status not updated)
  const storyName = basename(storyRelativePath, ".md");
  if (await hasCommitForStory(opts.projectPath, storyName)) {
    return { skip: true, reason: "git-history" };
  }

  return { skip: false };
}
