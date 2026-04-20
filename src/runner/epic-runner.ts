import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { runStory } from "./story-runner.js";
import { testAuth } from "../sdk/auth-prober.js";
import { shouldSkipStory } from "../git/skip-detection.js";
import type { ResolvedStoryConfig } from "../config/schema.js";
import type { EpicConfig } from "../config/schema.js";
import type { Notifier } from "../notify/ntfy.js";
import type { Logger } from "../logging/logger.js";
import { Timer } from "../util/timer.js";
import type { EpicResult, StoryOutcome } from "./types.js";

export async function runEpic(
  epicConfig: EpicConfig,
  storyConfig: ResolvedStoryConfig,
  deps: {
    notifier: Notifier;
    logger: Logger;
    logsBaseDir: string;
    startFrom: number;
    dryRun: boolean;
  }
): Promise<EpicResult> {
  const { logger, notifier, logsBaseDir, startFrom, dryRun } = deps;
  const epicName = epicConfig.epic.name;
  const logsDir = resolve(logsBaseDir, epicName);
  const timer = new Timer();

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let exitCode: 0 | 1 | 2 = 0;

  logger.info("Testing Claude connectivity...");
  if (!(await testAuth(storyConfig.model, (msg) => logger.info(msg)))) {
    logger.error(
      "Claude not reachable. Make sure 'claude' is in PATH and authenticated."
    );
    await notifier.notifyStory({
      title: "Runner failed",
      message: "Claude not reachable — check CLI auth",
      priority: "urgent",
      tags: "x",
    });
    return {
      epicName,
      completed: 0,
      failed: 1,
      skipped: 0,
      durationMs: timer.elapsedMs(),
      exitCode: 1,
    };
  }
  logger.info("Claude is ready");

  logger.info("═".repeat(50));
  logger.info(`Epic: ${epicName}`);
  logger.info(
    `Stories: ${epicConfig.stories.length} total, starting from step ${startFrom}`
  );
  logger.info("═".repeat(50));

  await notifier.notifyStory({
    title: "Runner started",
    message: `${epicName}: ${epicConfig.stories.length} stories, starting from step ${startFrom}`,
    tags: "rocket",
  });

  for (let i = 0; i < epicConfig.stories.length; i++) {
    const storyPath = epicConfig.stories[i]!;
    const storyName = basename(storyPath, ".md");
    const step = i + 1;

    const skipResult = await shouldSkipStory(storyPath, {
      projectPath: storyConfig.projectPath,
      stepIndex: step,
      startFrom,
    });

    if (skipResult.skip) {
      logger.info(
        `SKIP [${step}/${epicConfig.stories.length}] ${storyName} (${skipResult.reason})`
      );
      skipped++;
      if (skipResult.reason !== "before-start") completed++;
      continue;
    }

    const fullPath = resolve(storyConfig.projectPath, storyPath);
    if (!existsSync(fullPath)) {
      logger.error(
        `Story file not found: ${storyPath} (resolved: ${fullPath})`
      );
      failed++;
      await notifier.notifyStory({
        title: "Story missing",
        message: `[${step}/${epicConfig.stories.length}] File not found: ${storyPath}`,
        priority: "high",
        tags: "warning",
      });
      continue;
    }

    if (dryRun) {
      logger.info(
        `DRY RUN [${step}/${epicConfig.stories.length}] Would run: ${storyName}`
      );
      continue;
    }

    logger.info("─".repeat(50));
    logger.info(`[${step}/${epicConfig.stories.length}] Running: ${storyName}`);
    await notifier.notifyStory({
      title: "Story starting",
      message: `[${step}/${epicConfig.stories.length}] ${storyName}`,
      tags: "hourglass",
    });

    const storyTimer = new Timer();
    const outcome: StoryOutcome = await runStory(storyPath, storyConfig, {
      notifier,
      logger,
      logsDir,
    });

    if (outcome.status === "success") {
      completed++;
      logger.info(
        `DONE [${step}/${epicConfig.stories.length}] ${storyName} (${storyTimer.format()})`
      );
      await notifier.notifyStory({
        title: "Story done",
        message: `[${step}/${epicConfig.stories.length}] ${storyName} (${storyTimer.format()})`,
        tags: "white_check_mark",
      });
    } else if (outcome.status === "failed") {
      failed++;
      exitCode = outcome.exitCode;
      logger.error(
        `FAILED [${step}/${epicConfig.stories.length}] ${storyName} — ${outcome.reason}`
      );

      if (outcome.exitCode === 2) {
        await notifier.notifyStory({
          title: "API Error — runner stopped",
          message: `[${step}/${epicConfig.stories.length}] ${storyName} — ${outcome.reason}`,
          priority: "urgent",
          tags: "rotating_light",
        });
      } else {
        await notifier.notifyStory({
          title: "Story failed — stopping epic",
          message: `[${step}/${epicConfig.stories.length}] ${storyName} — ${outcome.reason}`,
          priority: "urgent",
          tags: "rotating_light",
        });
      }
      break;
    }
  }

  logger.info("═".repeat(50));
  logger.info(
    `Summary: ${completed} completed, ${failed} failed, ${skipped} skipped (${timer.format()})`
  );
  logger.info("═".repeat(50));

  if (failed === 0) {
    await notifier.notifyStory({
      title: "Run complete",
      message: `${epicName}: all ${completed} stories done (${skipped} skipped) in ${timer.format()}`,
      tags: "tada",
    });
  } else {
    await notifier.notifyStory({
      title: "Run finished",
      message: `${epicName}: ${completed} done, ${failed} failed, ${skipped} skipped in ${timer.format()}`,
      priority: "high",
      tags: "warning",
    });
  }

  return {
    epicName,
    completed,
    failed,
    skipped,
    durationMs: timer.elapsedMs(),
    exitCode: failed > 0 ? exitCode || 1 : 0,
  };
}
