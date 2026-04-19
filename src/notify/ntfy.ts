export type Priority = "default" | "high" | "urgent";

export interface NotifyOptions {
  title: string;
  message: string;
  priority?: Priority;
  tags?: string;
}

export class NtfyNotifier {
  private readonly baseUrl: string;
  private readonly storyTopic: string | undefined;
  private readonly runAllTopic: string | undefined;

  constructor(opts: {
    baseUrl: string;
    storyTopic?: string;
    runAllTopic?: string;
  }) {
    this.baseUrl = opts.baseUrl;
    this.storyTopic = opts.storyTopic;
    this.runAllTopic = opts.runAllTopic;
  }

  async notifyStory(opts: NotifyOptions): Promise<void> {
    if (!this.storyTopic) return;
    await this.send(this.storyTopic, opts);
  }

  async notifyRunAll(opts: NotifyOptions): Promise<void> {
    if (!this.runAllTopic) return;
    await this.send(this.runAllTopic, opts);
  }

  private async send(topic: string, opts: NotifyOptions): Promise<void> {
    try {
      const headers: Record<string, string> = {
        Title: opts.title,
        Priority: opts.priority ?? "default",
      };
      if (opts.tags) {
        headers["Tags"] = opts.tags;
      }

      await fetch(`${this.baseUrl}/${topic}`, {
        method: "POST",
        headers,
        body: opts.message,
      });
    } catch {
      // Notification failures are non-fatal
    }
  }
}

export class NoopNotifier {
  async notifyStory(_opts: NotifyOptions): Promise<void> {}
  async notifyRunAll(_opts: NotifyOptions): Promise<void> {}
}

export type Notifier = NtfyNotifier | NoopNotifier;

export function createNotifier(config: {
  provider: "ntfy" | "none";
  ntfy: { baseUrl: string; storyTopic?: string; runAllTopic?: string };
}): Notifier {
  if (config.provider === "none") return new NoopNotifier();
  return new NtfyNotifier(config.ntfy);
}
