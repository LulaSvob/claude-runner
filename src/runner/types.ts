export type StoryOutcome =
  | {
      status: "success";
      durationMs: number;
      costUsd: number;
    }
  | {
      status: "skipped";
      reason: "done-marker" | "git-history" | "before-start";
    }
  | {
      status: "failed";
      exitCode: 1 | 2;
      reason: string;
      durationMs: number;
    };

export interface EpicResult {
  epicName: string;
  completed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  exitCode: 0 | 1 | 2;
}

export interface RunAllResult {
  epicsOk: number;
  epicsFailed: number;
  durationMs: number;
  exitCode: 0 | 1;
}
