import { query } from "@anthropic-ai/claude-agent-sdk";

const AUTH_PROBE_TIMEOUT_MS = 60_000;

export type AuthProbeResult =
  | { ok: true }
  | { ok: false; reason: "auth" | "quota" | "timeout" | "error"; message: string };

export async function testAuth(
  model: string,
  log?: (msg: string) => void
): Promise<AuthProbeResult> {
  const info = log ?? (() => {});
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(
    () => abortController.abort(),
    AUTH_PROBE_TIMEOUT_MS,
  );

  try {
    info(`Auth probe: model=${model} (timeout=${AUTH_PROBE_TIMEOUT_MS}ms)`);
    const q = query({
      prompt: "Say OK",
      options: {
        model,
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController,
      },
    });

    for await (const msg of q) {
      info(`Auth probe msg: type=${msg.type}${"subtype" in msg && msg.subtype ? ` subtype=${msg.subtype}` : ""}${"error" in msg && msg.error ? ` error=${msg.error}` : ""}`);

      if (
        msg.type === "rate_limit_event" &&
        "rate_limit_info" in msg &&
        (msg as { rate_limit_info: { status: string } }).rate_limit_info.status === "rejected"
      ) {
        info("Auth probe: quota rejected");
        try { await q.interrupt(); } catch {}
        return { ok: false, reason: "quota", message: "Quota exhausted" };
      }

      if (msg.type === "assistant" && msg.error === "authentication_failed") {
        return { ok: false, reason: "auth", message: "Authentication failed" };
      }
      if (msg.type === "result" && msg.subtype === "success") {
        return { ok: true };
      }
      if (msg.type === "result") {
        const detail = JSON.stringify(msg).slice(0, 500);
        info(`Auth probe result: ${detail}`);
        return { ok: false, reason: "error", message: `Unexpected result: ${detail}` };
      }
    }
    info("Auth probe: stream ended without result");
    return { ok: false, reason: "error", message: "Stream ended without result" };
  } catch (err: unknown) {
    const timedOut = abortController.signal.aborted;
    const message = err instanceof Error ? err.message : String(err);
    info(`Auth probe ${timedOut ? "timeout" : "error"}: ${message}`);
    return {
      ok: false,
      reason: timedOut ? "timeout" : "error",
      message,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
