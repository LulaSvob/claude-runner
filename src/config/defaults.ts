import type { Defaults } from "./schema.js";

export const DEFAULT_VALUES: Omit<Required<Defaults>, "maxBudgetUsd"> = {
  model: "claude-opus-4-6[1m]",
  maxRetries: 2,
  storyTimeoutSeconds: 2700,
  quotaWaitSeconds: 3600,
  quotaMaxWaits: 12,
  authPollIntervalSeconds: 180,
};
