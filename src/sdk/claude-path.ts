import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

export function resolveClaudePath(): string {
  if (cached) return cached;

  // 1. Try the glibc binary bundled with the SDK (works on standard Linux)
  const sdkGlibc = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude",
  );
  if (existsSync(sdkGlibc)) {
    cached = sdkGlibc;
    return cached;
  }

  // 2. Fall back to system-installed claude (from native installer)
  try {
    const which = execSync("which claude", { encoding: "utf-8" }).trim();
    if (which && existsSync(which)) {
      cached = which;
      return cached;
    }
  } catch {}

  // 3. Give up — let the SDK try its default resolution
  return "claude";
}
