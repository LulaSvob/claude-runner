import { z } from "zod";

export const defaultsSchema = z.object({
  model: z.string().default("claude-opus-4-6[1m]"),
  maxRetries: z.number().int().min(1).default(2),
  storyTimeoutSeconds: z.number().int().min(60).default(2700),
  maxBudgetUsd: z.number().positive().optional(),
  quotaWaitSeconds: z.number().int().min(60).default(3600),
  quotaMaxWaits: z.number().int().min(1).default(12),
  authPollIntervalSeconds: z.number().int().min(30).default(180),
});

export type Defaults = z.infer<typeof defaultsSchema>;

export const ntfyConfigSchema = z.object({
  baseUrl: z.string().url().default("https://ntfy.sh"),
  storyTopic: z.string().optional(),
  runAllTopic: z.string().optional(),
});

export const notifyConfigSchema = z.object({
  provider: z.enum(["ntfy", "none"]).default("ntfy"),
  ntfy: ntfyConfigSchema.default(() => ({ baseUrl: "https://ntfy.sh" })),
});

export const loggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  sdkDebug: z.boolean().default(true),
});

export const globalConfigSchema = z.object({
  defaults: defaultsSchema.default(() => ({
    model: "claude-opus-4-6[1m]",
    maxRetries: 2,
    storyTimeoutSeconds: 2700,
    quotaWaitSeconds: 3600,
    quotaMaxWaits: 12,
    authPollIntervalSeconds: 180,
  })),
  notify: notifyConfigSchema.default(() => ({ provider: "ntfy" as const, ntfy: { baseUrl: "https://ntfy.sh" } })),
  logging: loggingConfigSchema.default(() => ({ level: "info" as const, sdkDebug: true })),
  resumeSentinel: z.string().default("/tmp/claude-runner-resume"),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const gitConfigSchema = z.object({
  commitTemplate: z
    .string()
    .default("feat({scope}): implement {storyName}"),
  coAuthor: z
    .string()
    .default("Claude Opus 4.6 (1M context) <noreply@anthropic.com>"),
  protectedBranches: z.array(z.string()).default(["main", "master"]),
  autoCommit: z.boolean().default(true),
  autoPush: z.boolean().default(true),
});

export const projectConfigSchema = z.object({
  project: z.object({
    name: z.string(),
    path: z.string(),
    branch: z.string().default("develop"),
  }),
  promptTemplate: z.string().default("/flow @{storyPath}"),
  git: gitConfigSchema.default(() => ({
    commitTemplate: "feat({scope}): implement {storyName}",
    coAuthor: "Claude Opus 4.6 (1M context) <noreply@anthropic.com>",
    protectedBranches: ["main", "master"],
    autoCommit: true,
    autoPush: true,
  })),
  defaults: defaultsSchema.partial().optional(),
  notify: z
    .object({
      ntfy: ntfyConfigSchema.partial().optional(),
    })
    .optional(),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export const epicConfigSchema = z.object({
  epic: z.object({
    name: z.string(),
  }),
  branch: z.string().optional(),
  maxRetries: z.number().int().min(1).optional(),
  storyTimeoutSeconds: z.number().int().min(60).optional(),
  stories: z.array(z.string()).min(1),
});

export type EpicConfig = z.infer<typeof epicConfigSchema>;

export const runAllConfigSchema = z.object({
  epicOrder: z.array(z.string()).min(1),
  optional: z.array(z.string()).optional(),
  skipFailed: z.boolean().default(false),
});

export type RunAllConfig = z.infer<typeof runAllConfigSchema>;

export interface ResolvedStoryConfig {
  model: string;
  maxRetries: number;
  storyTimeoutSeconds: number;
  maxBudgetUsd: number | undefined;
  quotaWaitSeconds: number;
  quotaMaxWaits: number;
  authPollIntervalSeconds: number;
  projectPath: string;
  branch: string;
  promptTemplate: string;
  git: z.infer<typeof gitConfigSchema>;
  notify: {
    provider: "ntfy" | "none";
    ntfy: z.infer<typeof ntfyConfigSchema>;
  };
  logging: z.infer<typeof loggingConfigSchema>;
  resumeSentinel: string;
}
