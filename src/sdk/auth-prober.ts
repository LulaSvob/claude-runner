import { query } from "@anthropic-ai/claude-agent-sdk";

export async function testAuth(model: string): Promise<boolean> {
  try {
    const q = query({
      prompt: "Say OK",
      options: {
        model,
        maxTurns: 1,
        maxBudgetUsd: 0.01,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const msg of q) {
      if (msg.type === "assistant" && msg.error === "authentication_failed") {
        return false;
      }
      if (msg.type === "result" && msg.subtype === "success") {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
