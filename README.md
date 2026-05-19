# claude-runner

A TypeScript CLI that orchestrates unattended Claude Code sessions at scale. It drives the `@anthropic-ai/claude-agent-sdk` to run "stories" (markdown task files) through Claude Code, with retry logic, quota/auth handling, git automation, and push notifications.

## Quick Start

```bash
npm install
npm run build

# Run all epics for a project
npm run dev -- run-all --project development-orchestrator

# Run a single epic
npm run dev -- run-epic epic-07-pipeline-execution --project development-orchestrator

# Run a single story
npm run dev -- run-story backlog/phase-2/epic-07/us-07.01-pipeline-execution-engine.md --project development-orchestrator

# Check completion status
npm run dev -- status --project development-orchestrator
```

## Supervisor (run until done)

The supervisor wrapper restarts the runner on failure until all epics complete:

```bash
./bin/supervisor.sh --project development-orchestrator --from 7

# Configurable via environment variables
RETRY_DELAY=120 MAX_CONSECUTIVE_FAILURES=5 ./bin/supervisor.sh --project my-project
```

## How It Works

**Three-level runner hierarchy:**

- **all-runner** loads `run-all.yaml`, iterates epics, delegates to epic-runner
- **epic-runner** iterates stories within an epic, checks skip conditions, delegates to story-runner
- **story-runner** is the core loop: launches a Claude SDK session, monitors the stream, handles retries via `RetryStateMachine`, manages git stash/commit/push, and sends notifications

**Error handling:**

- Quota/rate-limit errors trigger wait loops (not retry counter)
- Auth errors pause until `testAuth()` succeeds
- Normal failures use exponential backoff up to `maxRetries`
- Stream stall detection aborts hung sessions
- API stream stall detection catches SSE disconnects
- Memory guard kills runaway native subprocesses
- Git push failures don't waste retries (commit and push are decoupled)

**Skip detection:** Stories marked `**Status:** DONE` or `FIXED` are skipped. Falls back to git log grep for stories implemented but not formally accepted.

## Project Configuration

Projects live in `projects/<name>/` with:

```
projects/my-project/
  project.yaml        # project path, branch, git config, prompt template, ntfy topics
  run-all.yaml         # epic execution order, optional epics, skipFailed
  epic-01-foo.yaml     # story list and optional per-epic overrides
  epic-02-bar.yaml
```

### Config Resolution

Four-layer merge (lower overrides higher):
1. `config.yaml` (global defaults)
2. `project.yaml` (per-project)
3. `epic-*.yaml` (per-epic overrides)
4. CLI flags

### Key Defaults

| Setting | Default | Description |
|---------|---------|-------------|
| `model` | `claude-sonnet-4-6[1m]` | Claude model for sessions |
| `advisorModel` | `claude-opus-4-6[1m]` | Model for the advisor tool |
| `maxRetries` | 5 | Max retry attempts per story |
| `storyTimeoutSeconds` | 10800 (3h) | Max wall-clock time per story |
| `streamStallTimeoutSeconds` | 600 (10m) | Abort after no SDK messages |
| `apiStreamStallEscalationSeconds` | 240 (4m) | Abort after SSE disconnect |
| `quotaWaitSeconds` | 3600 (1h) | Sleep duration on quota hit |
| `quotaMaxWaits` | 12 | Max quota wait cycles |
| `memoryGuardRssMb` | 8192 | Kill if RSS exceeds this |

## CLI Reference

All commands require `--project <name>`.

```
run-all                          Run every epic in order
  --from <n>                     Start from epic N (1-based)
  --to <n>                       End at epic N
  --skip-failed                  Continue past failed epics/stories
  --include-optional             Include optional epics

run-epic <epic-name>             Run one epic's stories
  --start-from <n>               Resume from story N (1-based)

run-story <story-path>           Run a single story
  --no-commit                    Skip git commit/push
  --no-notify                    Skip notifications

status                           Show completion status from logs
```

**Global flags:** `--model`, `--timeout`, `--max-retries`, `--branch`, `-v`/`-q`, `--dry-run`

## Resume Mechanisms

- **SIGUSR1**: Send to the runner PID to resume from a quota/auth wait early
- **File sentinel**: Create `/tmp/claude-runner-resume` to trigger resume
- **PID file**: Written to `/tmp/claude-runner.pid` on startup

## Notifications

Sends push notifications via [ntfy.sh](https://ntfy.sh) with separate topics for story-level and run-all-level events. Configure topics in `project.yaml`.

## Development

```bash
npm run dev -- <command> [options]   # Run via tsx
npm run build                        # tsc -> dist/
npm test                             # vitest (all tests)
npm run lint                         # tsc --noEmit (type-check)
```

## License

Private.
