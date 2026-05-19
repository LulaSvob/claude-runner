import { existsSync, mkdirSync, watch, unlinkSync, type FSWatcher } from "node:fs";
import { dirname, basename } from "node:path";

export interface ResumableWaiter {
  wait(ms: number): Promise<void>;
  dispose(): void;
}

export function createResumableWaiter(sentinelPath: string): ResumableWaiter {
  let resolver: (() => void) | null = null;
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  let wallClockCheck: NodeJS.Timeout | null = null;

  const onSignal = () => resolver?.();

  process.on("SIGUSR1", onSignal);

  return {
    async wait(ms: number): Promise<void> {
      const deadline = Date.now() + ms;

      return new Promise<void>((res) => {
        resolver = res;
        timer = setTimeout(res, ms);

        // Wall-clock guard: check every 30s whether the deadline has passed.
        // setTimeout freezes during system suspend (WSL sleep, lid close).
        // This interval fires on wake and catches the overshoot.
        wallClockCheck = setInterval(() => {
          if (Date.now() >= deadline) res();
        }, 30_000);

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
        if (watcher) watcher.close();
        watcher = null;
        wallClockCheck = null;
        timer = null;
        resolver = null;
      });
    },
    dispose() {
      process.removeListener("SIGUSR1", onSignal);
      if (watcher) watcher.close();
      if (wallClockCheck) clearInterval(wallClockCheck);
      if (timer) clearTimeout(timer);
    },
  };
}
