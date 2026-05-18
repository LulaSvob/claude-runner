import { watch, statSync, createReadStream, type FSWatcher } from "node:fs";

const STALL_RE =
  /\[WARN\] Streaming stall detected: ([\d.]+)s gap between events \(stall #(\d+)\)/;
const COMPLETED_RE = /\[WARN\] Streaming completed with \d+ stall\(s\)/;

export interface DebugLogTailEvents {
  onStallWarning: (info: { gapSeconds: number; stallNumber: number }) => void;
  onStreamCompleted: () => void;
}

export interface DebugLogTail {
  stop(): void;
}

export function startDebugLogTail(
  filePath: string,
  events: DebugLogTailEvents,
): DebugLogTail {
  let lastOffset: number;
  try {
    lastOffset = statSync(filePath).size;
  } catch {
    lastOffset = 0;
  }

  let partialLine = "";
  let watcher: FSWatcher | null = null;

  function processLine(line: string): void {
    const stallMatch = line.match(STALL_RE);
    if (stallMatch) {
      events.onStallWarning({
        gapSeconds: parseFloat(stallMatch[1]!),
        stallNumber: parseInt(stallMatch[2]!, 10),
      });
      return;
    }
    if (COMPLETED_RE.test(line)) {
      events.onStreamCompleted();
    }
  }

  function readNewBytes(): void {
    let currentSize: number;
    try {
      currentSize = statSync(filePath).size;
    } catch {
      return;
    }
    if (currentSize <= lastOffset) return;

    const stream = createReadStream(filePath, {
      start: lastOffset,
      end: currentSize - 1,
      encoding: "utf-8",
    });

    let chunk = "";
    stream.on("data", (data: Buffer | string) => {
      chunk += String(data);
    });
    stream.on("end", () => {
      lastOffset = currentSize;
      const text = partialLine + chunk;
      const lines = text.split("\n");
      partialLine = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) processLine(line);
      }
    });
  }

  try {
    watcher = watch(filePath, { persistent: false }, () => {
      readNewBytes();
    });
  } catch {
    // fs.watch not available — feature degrades gracefully
  }

  return {
    stop() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}
