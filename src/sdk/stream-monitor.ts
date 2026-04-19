import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { classifyMessage, type ErrorSignal } from "../errors/classifier.js";

export type StreamEvent =
  | { kind: "error"; signal: ErrorSignal }
  | { kind: "text"; text: string }
  | { kind: "result_success"; costUsd: number; result: string }
  | {
      kind: "result_error";
      subtype: string;
      errors: string[];
      costUsd: number;
    };

export class StreamMonitor {
  private readonly onEvent: (event: StreamEvent) => void;

  constructor(onEvent: (event: StreamEvent) => void) {
    this.onEvent = onEvent;
  }

  process(msg: SDKMessage): ErrorSignal | null {
    const signal = classifyMessage(msg);

    if (signal) {
      this.onEvent({ kind: "error", signal });
      return signal;
    }

    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          this.onEvent({ kind: "text", text: block.text });
        }
      }
    }

    if (msg.type === "result") {
      if (msg.subtype === "success") {
        this.onEvent({
          kind: "result_success",
          costUsd: msg.total_cost_usd,
          result: msg.result,
        });
      } else {
        this.onEvent({
          kind: "result_error",
          subtype: msg.subtype,
          errors: "errors" in msg ? (msg.errors as string[]) : [],
          costUsd: msg.total_cost_usd,
        });
      }
    }

    return null;
  }
}
