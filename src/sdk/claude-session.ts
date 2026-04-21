import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { StreamMonitor, type StreamEvent } from "./stream-monitor.js";
import type { ErrorSignal } from "../errors/classifier.js";
import type { ResolvedStoryConfig } from "../config/schema.js";
import { resolve } from "node:path";

export interface SessionResult {
  success: boolean;
  costUsd: number;
  result: string;
  errorSignal: ErrorSignal | null;
  timedOut: boolean;
}

export async function runStory(
  storyPath: string,
  config: ResolvedStoryConfig,
  opts: {
    onEvent: (event: StreamEvent) => void;
    logsDir: string;
    storyName: string;
  }
): Promise<SessionResult> {
  const prompt = config.promptTemplate.replace("{storyPath}", storyPath);
  const abortController = new AbortController();

  let q: Query | null = null;

  const timeoutHandle = setTimeout(() => {
    abortController.abort();
    // AbortController alone doesn't work when the SDK is sleeping in its
    // internal retry backoff. interrupt() sends SIGINT to the child process.
    if (q) {
      q.interrupt().catch(() => {});
    }
  }, config.storyTimeoutSeconds * 1000);

  const monitor = new StreamMonitor(opts.onEvent);
  let errorSignal: ErrorSignal | null = null;
  let costUsd = 0;
  let result = "";

  try {
    const debugFile = config.logging.sdkDebug
      ? resolve(opts.logsDir, `${opts.storyName}.debug.log`)
      : undefined;

    q = query({
      prompt,
      options: {
        cwd: config.projectPath,
        model: config.model,
        maxBudgetUsd: config.maxBudgetUsd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController,
        ...(debugFile ? { debugFile } : {}),
      },
    });

    for await (const msg of q) {
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

    const timedOut = abortController.signal.aborted;

    return {
      success: errorSignal === null && !timedOut && result !== "",
      costUsd,
      result,
      errorSignal,
      timedOut,
    };
  } catch (err: unknown) {
    const timedOut = abortController.signal.aborted;
    const isAbort =
      timedOut ||
      (err instanceof Error && err.message.includes("aborted"));

    if (isAbort) {
      return {
        success: false,
        costUsd,
        result,
        errorSignal,
        timedOut: true,
      };
    }

    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
