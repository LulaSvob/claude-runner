import type { Defaults } from "./schema.js";

export const DEFAULT_VALUES: Omit<Required<Defaults>, "maxBudgetUsd"> = {
  model: "claude-opus-4-6[1m]",
  maxRetries: 2,
  storyTimeoutSeconds: 10800,
  streamStallTimeoutSeconds: 300,
  quotaWaitSeconds: 3600,
  quotaMaxWaits: 12,
  authPollIntervalSeconds: 180,
  memoryGuardRssMb: 8192,
  memoryGuardCheckIntervalSeconds: 30,
};
