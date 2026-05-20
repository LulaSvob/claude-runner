# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

claude-runner is a TypeScript CLI that orchestrates unattended Claude Code sessions at scale. It drives the `@anthropic-ai/claude-agent-sdk` to run "stories" (markdown task files) through Claude Code, with retry logic, quota/auth handling, git automation, and ntfy push notifications. Projects are configured via YAML; the runner executes stories sequentially within epics, and epics sequentially within a full project run.

## Commands

```bash
npm run dev -- <command> [options]   # Run via tsx (development)
npm run build                        # tsc → dist/
npm test                             # vitest run (all tests)
npx vitest run test/classifier.test.ts  # single test file
npm run lint                         # tsc --noEmit (type-check only)
```

CLI commands (all require `--project <name>`):
- `run-all` — run every epic in order (`--from`, `--to`, `--skip-failed`, `--include-optional`)
- `run-epic <epic-name>` — run one epic (`--start-from <n>`)
- `run-story <story-path>` — run a single story (`--no-commit`, `--no-notify`)
- `status` — show completion status from logs

Global flags: `--model`, `--timeout`, `--max-retries`, `--branch`, `-v`/`-q`, `--dry-run`.

## Architecture

**Three-level runner hierarchy:**
- `all-runner` loads `run-all.yaml`, iterates epics, delegates to `epic-runner`
- `epic-runner` iterates stories within an epic, checks skip conditions, delegates to `story-runner`
- `story-runner` is the core loop: launches a Claude SDK session, monitors the stream, handles retries via `RetryStateMachine`, manages git stash/commit/push, and sends notifications

**Config resolution** (`src/config/`): Four-layer merge — `config.yaml` (global defaults) → `project.yaml` (per-project) → epic YAML (per-epic overrides) → CLI flags. Schemas validated with Zod. The resolved config is `ResolvedStoryConfig`.

**Error handling** (`src/errors/`): `classifier.ts` maps raw SDK messages to `ErrorSignal` types (quota, auth, budget_exceeded, api_error, server_error). `RetryStateMachine` decides retry/wait/abort based on signal type and accumulated state — quota errors trigger wait loops (not retry counter), auth errors pause until `testAuth()` succeeds, normal failures use exponential backoff.

**SDK integration** (`src/sdk/`): `claude-session.ts` wraps `query()` from the agent SDK. Manages stall detection (configurable threshold), system-sleep detection (heartbeat timer), memory guard (polls /proc RSS for the SDK process tree), and timeout with graceful interrupt → SIGKILL escalation. `auth-prober.ts` does a lightweight "Say OK" query to verify connectivity.

**Git operations** (`src/git/`): Branch validation (refuses protected branches), stash-on-retry (preserves partial work from failed attempts), commit-and-push with templated messages, skip detection (checks story `**Status:**` markers and git log).

**Notifications** (`src/notify/`): ntfy.sh push notifications with separate topics for story-level and run-all-level events. Non-fatal on failure.

**Process cleanup** (`src/util/process-tree.ts`): Kills orphaned process trees from crashed runs (matches by cwd in /proc), stale vitest/turbo processes, and SDK child trees via debug log file matching. Linux-specific (/proc).

## Project configuration

Projects live in `projects/<name>/` with:
- `project.yaml` — project path, branch, git config, prompt template, ntfy topics
- `run-all.yaml` — epic execution order, optional epics
- `epic-*.yaml` — story list and optional per-epic overrides

Story skip detection uses `**Status:**` markers in the story markdown (case-insensitive match for "done" or "fixed"), falling back to git log grep by full story name or story ID in commit scope.

## Key design decisions

- Exit code 2 means API/quota cap errors (halt entire run); exit code 1 means normal failures (stop current epic only if `skipFailed` is false)
- On retry, previous work is git-stashed (not discarded) and retry context is injected into the prompt telling Claude to `git stash pop` and continue
- Stall timers are suspended while awaiting tool results (long bash commands are expected silence)
- The runner injects a "RUNNER_DISCIPLINE_PROMPT" into every session forbidding `run_in_background=true` for heavy commands
- Resume can be triggered via SIGUSR1 or a file sentinel (`/tmp/claude-runner-resume`)
- The memory guard reads `/proc/<pid>/status` VmRSS — Linux only
