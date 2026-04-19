import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { resolve } from "node:path";

export class LogSink {
  private stream: WriteStream;

  constructor(logsDir: string, storyName: string) {
    mkdirSync(logsDir, { recursive: true });
    const logPath = resolve(logsDir, `${storyName}.log`);
    this.stream = createWriteStream(logPath, { flags: "w" });
  }

  write(text: string): void {
    this.stream.write(text);
  }

  writeLine(text: string): void {
    this.stream.write(text + "\n");
  }

  close(): void {
    this.stream.end();
  }
}
