export class Timer {
  private startMs: number;

  constructor() {
    this.startMs = Date.now();
  }

  elapsedMs(): number {
    return Date.now() - this.startMs;
  }

  elapsedSeconds(): number {
    return Math.floor(this.elapsedMs() / 1000);
  }

  format(): string {
    const total = this.elapsedSeconds();
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}m ${secs}s`;
  }

  reset(): void {
    this.startMs = Date.now();
  }
}
