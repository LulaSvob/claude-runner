import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type ErrorSignalType =
  | "quota"
  | "quota_warning"
  | "api_retry_rate_limit"
  | "auth"
  | "budget_exceeded"
  | "api_error"
  | "server_error";

export type ErrorSignal =
  | { type: "quota"; resetsAt: number | undefined }
  | { type: "quota_warning"; utilization: number | undefined }
  | { type: "api_retry_rate_limit"; retryDelayMs: number }
  | { type: "auth" }
  | { type: "budget_exceeded"; costUsd: number }
  | { type: "api_error"; status: number | null }
  | { type: "server_error"; message: string };

export function classifyMessage(msg: SDKMessage): ErrorSignal | null {
  if (
    msg.type === "rate_limit_event" &&
    msg.rate_limit_info.status === "rejected"
  ) {
    return { type: "quota", resetsAt: msg.rate_limit_info.resetsAt };
  }

  if (
    msg.type === "rate_limit_event" &&
    msg.rate_limit_info.status === "allowed_warning"
  ) {
    return {
      type: "quota_warning",
      utilization: msg.rate_limit_info.utilization,
    };
  }

  if (
    msg.type === "system" &&
    "subtype" in msg &&
    msg.subtype === "api_retry"
  ) {
    const retryMsg = msg as {
      error: string;
      error_status: number | null;
      retry_delay_ms: number;
    };
    if (retryMsg.error === "rate_limit") {
      return {
        type: "api_retry_rate_limit",
        retryDelayMs: retryMsg.retry_delay_ms,
      };
    }
    if (
      retryMsg.error === "server_error" ||
      (retryMsg.error_status !== null && retryMsg.error_status >= 500)
    ) {
      return { type: "api_error", status: retryMsg.error_status };
    }
  }

  if (msg.type === "assistant" && msg.error === "authentication_failed") {
    return { type: "auth" };
  }

  if (msg.type === "assistant" && msg.error === "billing_error") {
    return { type: "quota", resetsAt: undefined };
  }

  if (msg.type === "assistant" && msg.error === "rate_limit") {
    return { type: "quota", resetsAt: undefined };
  }

  if (msg.type === "assistant" && msg.error === "server_error") {
    return { type: "server_error", message: "Assistant server error" };
  }

  if (msg.type === "result" && msg.subtype === "error_max_budget_usd") {
    const resultMsg = msg as { total_cost_usd: number };
    return { type: "budget_exceeded", costUsd: resultMsg.total_cost_usd };
  }

  return null;
}
