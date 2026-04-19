import type { ErrorSignal } from "./classifier.js";

export type RetryAction =
  | { action: "retry" }
  | { action: "quota_wait"; sleepMs: number }
  | { action: "auth_wait" }
  | { action: "abort"; exitCode: 1 | 2; reason: string };

export interface RetryState {
  attempt: number;
  quotaWaits: number;
  apiErrors: number;
}

export class RetryStateMachine {
  private state: RetryState;
  private readonly maxRetries: number;
  private readonly quotaMaxWaits: number;
  private readonly quotaWaitMs: number;

  constructor(opts: {
    maxRetries: number;
    quotaMaxWaits: number;
    quotaWaitSeconds: number;
  }) {
    this.maxRetries = opts.maxRetries;
    this.quotaMaxWaits = opts.quotaMaxWaits;
    this.quotaWaitMs = opts.quotaWaitSeconds * 1000;
    this.state = { attempt: 1, quotaWaits: 0, apiErrors: 0 };
  }

  getState(): Readonly<RetryState> {
    return { ...this.state };
  }

  decide(signal: ErrorSignal): RetryAction {
    switch (signal.type) {
      case "quota":
      case "api_retry_rate_limit":
        return this.handleQuota(
          signal.type === "quota" ? signal.resetsAt : undefined
        );

      case "auth":
        return { action: "auth_wait" };

      case "budget_exceeded":
        return {
          action: "abort",
          exitCode: 2,
          reason: `Budget exceeded: $${signal.costUsd.toFixed(2)}`,
        };

      case "api_error":
      case "server_error":
        return this.handleApiError();

      case "quota_warning":
        return { action: "retry" };

      default: {
        const _exhaustive: never = signal;
        return _exhaustive;
      }
    }
  }

  handleNormalFailure(): RetryAction {
    this.state.apiErrors = 0;

    if (this.state.attempt < this.maxRetries) {
      const delayMs = 30_000 * this.state.attempt;
      this.state.attempt++;
      return { action: "quota_wait", sleepMs: delayMs };
    }

    return {
      action: "abort",
      exitCode: 1,
      reason: `All ${this.maxRetries} retries exhausted`,
    };
  }

  private handleQuota(resetsAt: number | undefined): RetryAction {
    this.state.quotaWaits++;

    if (this.state.quotaWaits > this.quotaMaxWaits) {
      return {
        action: "abort",
        exitCode: 2,
        reason: `Quota wait cap exceeded (${this.state.quotaWaits} > ${this.quotaMaxWaits})`,
      };
    }

    let sleepMs: number;
    if (resetsAt) {
      const now = Date.now();
      const resetMs =
        resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
      sleepMs = Math.max(resetMs - now, 60_000);
    } else {
      sleepMs = this.quotaWaitMs;
    }

    return { action: "quota_wait", sleepMs };
  }

  private handleApiError(): RetryAction {
    this.state.apiErrors++;
    this.state.attempt++;

    if (this.state.apiErrors >= this.maxRetries) {
      return {
        action: "abort",
        exitCode: 2,
        reason: `${this.state.apiErrors} consecutive API errors`,
      };
    }

    const delayMs = 30_000 * this.state.attempt;
    return { action: "quota_wait", sleepMs: delayMs };
  }
}
