import { describe, it, expect } from "vitest";
import { classifyMessage } from "../src/errors/classifier.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

describe("classifyMessage", () => {
  it("detects rate_limit_event with rejected status as quota", () => {
    const msg = {
      type: "rate_limit_event" as const,
      rate_limit_info: {
        status: "rejected" as const,
        resetsAt: 1713520000,
        rateLimitType: "five_hour" as const,
      },
      uuid: "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "test-session",
    } satisfies SDKMessage;

    const signal = classifyMessage(msg);
    expect(signal).toEqual({
      type: "quota",
      resetsAt: 1713520000,
    });
  });

  it("detects rate_limit_event with allowed_warning as warning", () => {
    const msg = {
      type: "rate_limit_event" as const,
      rate_limit_info: {
        status: "allowed_warning" as const,
        utilization: 0.85,
      },
      uuid: "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "test-session",
    } satisfies SDKMessage;

    const signal = classifyMessage(msg);
    expect(signal).toEqual({
      type: "quota_warning",
      utilization: 0.85,
    });
  });

  it("detects assistant auth error", () => {
    const msg = {
      type: "assistant" as const,
      message: { content: [], role: "assistant" as const } as any,
      parent_tool_use_id: null,
      error: "authentication_failed" as const,
      uuid: "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "test-session",
    } satisfies SDKMessage;

    const signal = classifyMessage(msg);
    expect(signal).toEqual({ type: "auth" });
  });

  it("detects assistant rate_limit error", () => {
    const msg = {
      type: "assistant" as const,
      message: { content: [], role: "assistant" as const } as any,
      parent_tool_use_id: null,
      error: "rate_limit" as const,
      uuid: "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "test-session",
    } satisfies SDKMessage;

    const signal = classifyMessage(msg);
    expect(signal).toEqual({ type: "quota", resetsAt: undefined });
  });

  it("returns null for normal assistant messages", () => {
    const msg = {
      type: "assistant" as const,
      message: { content: [{ type: "text", text: "hello" }], role: "assistant" as const } as any,
      parent_tool_use_id: null,
      uuid: "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "test-session",
    } satisfies SDKMessage;

    const signal = classifyMessage(msg);
    expect(signal).toBeNull();
  });
});
