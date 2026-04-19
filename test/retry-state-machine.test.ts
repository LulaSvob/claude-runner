import { describe, it, expect } from "vitest";
import { RetryStateMachine } from "../src/errors/retry-state-machine.js";
import type { ErrorSignal } from "../src/errors/classifier.js";

function createRSM(overrides?: {
  maxRetries?: number;
  quotaMaxWaits?: number;
  quotaWaitSeconds?: number;
}) {
  return new RetryStateMachine({
    maxRetries: overrides?.maxRetries ?? 2,
    quotaMaxWaits: overrides?.quotaMaxWaits ?? 3,
    quotaWaitSeconds: overrides?.quotaWaitSeconds ?? 3600,
  });
}

describe("RetryStateMachine", () => {
  describe("quota errors", () => {
    it("returns quota_wait without incrementing attempt", () => {
      const rsm = createRSM();
      const signal: ErrorSignal = { type: "quota", resetsAt: undefined };
      const action = rsm.decide(signal);

      expect(action.action).toBe("quota_wait");
      expect(rsm.getState().attempt).toBe(1);
      expect(rsm.getState().quotaWaits).toBe(1);
    });

    it("uses resetsAt timestamp for sleep duration", () => {
      const rsm = createRSM();
      const futureMs = Date.now() + 120_000;
      const signal: ErrorSignal = {
        type: "quota",
        resetsAt: Math.floor(futureMs / 1000),
      };
      const action = rsm.decide(signal);

      expect(action.action).toBe("quota_wait");
      if (action.action === "quota_wait") {
        expect(action.sleepMs).toBeGreaterThan(60_000);
        expect(action.sleepMs).toBeLessThanOrEqual(125_000);
      }
    });

    it("falls back to quotaWaitSeconds when no resetsAt", () => {
      const rsm = createRSM({ quotaWaitSeconds: 1800 });
      const signal: ErrorSignal = { type: "quota", resetsAt: undefined };
      const action = rsm.decide(signal);

      if (action.action === "quota_wait") {
        expect(action.sleepMs).toBe(1_800_000);
      }
    });

    it("aborts when quota wait cap is exceeded", () => {
      const rsm = createRSM({ quotaMaxWaits: 2 });
      const signal: ErrorSignal = { type: "quota", resetsAt: undefined };

      rsm.decide(signal);
      rsm.decide(signal);
      const third = rsm.decide(signal);

      expect(third.action).toBe("abort");
      if (third.action === "abort") {
        expect(third.exitCode).toBe(2);
      }
    });
  });

  describe("auth errors", () => {
    it("returns auth_wait without incrementing counters", () => {
      const rsm = createRSM();
      const signal: ErrorSignal = { type: "auth" };
      const action = rsm.decide(signal);

      expect(action.action).toBe("auth_wait");
      expect(rsm.getState().attempt).toBe(1);
      expect(rsm.getState().quotaWaits).toBe(0);
      expect(rsm.getState().apiErrors).toBe(0);
    });
  });

  describe("API errors", () => {
    it("increments apiErrors and attempt", () => {
      const rsm = createRSM();
      const signal: ErrorSignal = { type: "api_error", status: 500 };
      rsm.decide(signal);

      expect(rsm.getState().apiErrors).toBe(1);
      expect(rsm.getState().attempt).toBe(2);
    });

    it("aborts when consecutive API errors reach max", () => {
      const rsm = createRSM({ maxRetries: 2 });
      const signal: ErrorSignal = { type: "api_error", status: 500 };

      rsm.decide(signal);
      const second = rsm.decide(signal);

      expect(second.action).toBe("abort");
      if (second.action === "abort") {
        expect(second.exitCode).toBe(2);
      }
    });
  });

  describe("normal failures", () => {
    it("uses exponential backoff", () => {
      const rsm = createRSM({ maxRetries: 3 });
      const first = rsm.handleNormalFailure();

      expect(first.action).toBe("quota_wait");
      if (first.action === "quota_wait") {
        expect(first.sleepMs).toBe(30_000);
      }
      expect(rsm.getState().attempt).toBe(2);
    });

    it("resets apiErrors on normal failure", () => {
      const rsm = createRSM();
      rsm.decide({ type: "api_error", status: 500 });
      expect(rsm.getState().apiErrors).toBe(1);

      rsm.handleNormalFailure();
      expect(rsm.getState().apiErrors).toBe(0);
    });

    it("aborts when max retries exhausted", () => {
      const rsm = createRSM({ maxRetries: 1 });
      const action = rsm.handleNormalFailure();

      expect(action.action).toBe("abort");
      if (action.action === "abort") {
        expect(action.exitCode).toBe(1);
      }
    });
  });

  describe("budget exceeded", () => {
    it("aborts immediately with exit code 2", () => {
      const rsm = createRSM();
      const signal: ErrorSignal = {
        type: "budget_exceeded",
        costUsd: 10.5,
      };
      const action = rsm.decide(signal);

      expect(action.action).toBe("abort");
      if (action.action === "abort") {
        expect(action.exitCode).toBe(2);
        expect(action.reason).toContain("10.50");
      }
    });
  });
});
