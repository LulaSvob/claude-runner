import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SkipReason = "story-done" | "story-fixed" | "before-start";

const DONE_STATUSES = ["✅ DONE", "✅ FIXED"];

function readStoryStatus(storyFilePath: string): string | null {
  if (!existsSync(storyFilePath)) return null;
  const content = readFileSync(storyFilePath, "utf-8");
  const match = /^\*\*Status:\*\*\s*(.+)$/m.exec(content);
  return match?.[1]?.trim() ?? null;
}

export function isStoryDone(storyFilePath: string): boolean {
  const status = readStoryStatus(storyFilePath);
  if (!status) return false;
  return DONE_STATUSES.some((s) => status.includes(s));
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

  if (status?.includes("✅ DONE")) {
    return { skip: true, reason: "story-done" };
  }
  if (status?.includes("✅ FIXED")) {
    return { skip: true, reason: "story-fixed" };
  }

  return { skip: false };
}
