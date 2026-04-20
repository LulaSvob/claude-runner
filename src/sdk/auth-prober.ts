import { query } from "@anthropic-ai/claude-agent-sdk";

export async function testAuth(
  model: string,
  log?: (msg: string) => void
): Promise<boolean> {
  const info = log ?? (() => {});
  try {
    info(`Auth probe: model=${model}`);
    const q = query({
      prompt: "Say OK",
      options: {
        model,
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const msg of q) {
      info(`Auth probe msg: type=${msg.type}${msg.subtype ? ` subtype=${msg.subtype}` : ""}${"error" in msg && msg.error ? ` error=${msg.error}` : ""}`);
      if (msg.type === "assistant" && msg.error === "authentication_failed") {
        return false;
      }
      if (msg.type === "result" && msg.subtype === "success") {
        return true;
      }
      if (msg.type === "result") {
        info(`Auth probe result: ${JSON.stringify(msg).slice(0, 500)}`);
        return false;
      }
    }
    info("Auth probe: stream ended without result");
    return false;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    info(`Auth probe error: ${message}`);
    return false;
  }
}
