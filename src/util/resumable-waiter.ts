import { existsSync, mkdirSync, watch, unlinkSync, type FSWatcher } from "node:fs";
import { dirname, basename } from "node:path";

export interface WaitOptions {
  onTick?: (remaining: { remainingMs: number; elapsedMs: number; resumeAt: Date }) => void;
  tickIntervalMs?: number;
}

export interface ResumableWaiter {
  wait(ms: number, opts?: WaitOptions): Promise<void>;
  dispose(): void;
}

export function createResumableWaiter(sentinelPath: string): ResumableWaiter {
  let resolver: (() => void) | null = null;
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  let wallClockCheck: NodeJS.Timeout | null = null;
  let tickTimer: NodeJS.Timeout | null = null;

  const onSignal = () => resolver?.();

  process.on("SIGUSR1", onSignal);

  return {
    async wait(ms: number, opts?: WaitOptions): Promise<void> {
      const deadline = Date.now() + ms;
      const startedAt = Date.now();
      const tickInterval = opts?.tickIntervalMs ?? 300_000; // default 5 min

      return new Promise<void>((res) => {
        resolver = res;
        timer = setTimeout(res, ms);

        // Wall-clock guard: check every 30s whether the deadline has passed.
        // setTimeout freezes during system suspend (WSL sleep, lid close).
        // This interval fires on wake and catches the overshoot.
        wallClockCheck = setInterval(() => {
          if (Date.now() >= deadline) res();
        }, 30_000);

        if (opts?.onTick) {
          const tick = opts.onTick;
          tickTimer = setInterval(() => {
            const now = Date.now();
            if (now < deadline) {
              tick({
                remainingMs: deadline - now,
                elapsedMs: now - startedAt,
                resumeAt: new Date(deadline),
              });
            }
          }, tickInterval);
        }

        try {
          const dir = dirname(sentinelPath);
          mkdirSync(dir, { recursive: true });
          watcher = watch(dir, (_, filename) => {
            if (
              filename === basename(sentinelPath) &&
              existsSync(sentinelPath)
            ) {
              try { unlinkSync(sentinelPath); } catch {}
              res();
            }
          });
        } catch {
          // fs.watch not available — fall back to timeout only
        }
      }).finally(() => {
        if (timer) clearTimeout(timer);
        if (wallClockCheck) clearInterval(wallClockCheck);
        if (tickTimer) clearInterval(tickTimer);
        if (watcher) watcher.close();
        watcher = null;
        wallClockCheck = null;
        tickTimer = null;
        timer = null;
        resolver = null;
      });
    },
    dispose() {
      process.removeListener("SIGUSR1", onSignal);
      if (watcher) watcher.close();
      if (wallClockCheck) clearInterval(wallClockCheck);
      if (tickTimer) clearInterval(tickTimer);
      if (timer) clearTimeout(timer);
    },
  };
}
