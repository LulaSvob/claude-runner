#!/usr/bin/env bash
#
# Supervisor wrapper for claude-runner run-all.
# Restarts the runner on exit until all epics complete (exit 0).
# Handles transient crashes, OOM kills, and unhandled errors.
#
# Includes a liveness watchdog: if the run-all log file has no new
# output for WATCHDOG_TIMEOUT seconds, the runner is killed and restarted.
# This catches Node.js timer freezes during WSL system sleep.
#
# Usage:
#   ./bin/supervisor.sh --project development-orchestrator [--from 6] [extra flags...]
#
# The supervisor passes all arguments through to `claude-runner run-all --skip-failed`.
# On non-zero exit it waits RETRY_DELAY seconds then restarts.
# On exit 0 (all epics done) or SIGINT/SIGTERM it stops.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_ROOT="$(dirname "$SCRIPT_DIR")"
RETRY_DELAY="${RETRY_DELAY:-60}"
MAX_CONSECUTIVE_FAILURES="${MAX_CONSECUTIVE_FAILURES:-10}"
# Watchdog kills runner if log is idle for this long (default: 75 min).
# Should be longer than quotaWaitSeconds (default 60 min) + margin.
WATCHDOG_TIMEOUT="${WATCHDOG_TIMEOUT:-4500}"
WATCHDOG_CHECK_INTERVAL="${WATCHDOG_CHECK_INTERVAL:-30}"

consecutive_failures=0
run_count=0
runner_pid=""
watchdog_pid=""

cleanup() {
  echo ""
  echo "[supervisor] Caught signal — shutting down."
  [ -n "$watchdog_pid" ] && kill "$watchdog_pid" 2>/dev/null || true
  [ -n "$runner_pid" ] && kill "$runner_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 130
}
trap cleanup SIGINT SIGTERM

# Extract --project value from args for log path discovery
project_name=""
args=("$@")
for i in "${!args[@]}"; do
  if [[ "${args[$i]}" == "--project" ]] && [ $((i + 1)) -lt ${#args[@]} ]; then
    project_name="${args[$((i + 1))]}"
    break
  fi
done

find_latest_log() {
  local log_dir="$RUNNER_ROOT/logs/${project_name}/run-all"
  if [ -d "$log_dir" ]; then
    ls -t "$log_dir"/run-*.log 2>/dev/null | head -1
  fi
}

start_watchdog() {
  (
    while true; do
      sleep "$WATCHDOG_CHECK_INTERVAL"

      log_file=$(find_latest_log)
      if [ -z "$log_file" ] || [ ! -f "$log_file" ]; then
        continue
      fi

      last_modified=$(stat -c %Y "$log_file" 2>/dev/null || echo 0)
      now=$(date +%s)
      idle_seconds=$((now - last_modified))

      if [ "$idle_seconds" -ge "$WATCHDOG_TIMEOUT" ]; then
        idle_minutes=$((idle_seconds / 60))
        echo "[watchdog] Log idle for ${idle_minutes}m (>${WATCHDOG_TIMEOUT}s) — killing runner (pid $runner_pid)"
        kill "$runner_pid" 2>/dev/null || true
        sleep 2
        kill -9 "$runner_pid" 2>/dev/null || true
        break
      fi
    done
  ) &
  watchdog_pid=$!
}

stop_watchdog() {
  if [ -n "$watchdog_pid" ]; then
    kill "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
    watchdog_pid=""
  fi
}

echo "[supervisor] Starting claude-runner supervisor"
echo "[supervisor] Runner root: $RUNNER_ROOT"
echo "[supervisor] Args: $*"
echo "[supervisor] Retry delay: ${RETRY_DELAY}s, max consecutive failures: ${MAX_CONSECUTIVE_FAILURES}"
echo "[supervisor] Watchdog timeout: ${WATCHDOG_TIMEOUT}s (check every ${WATCHDOG_CHECK_INTERVAL}s)"
echo ""

while true; do
  run_count=$((run_count + 1))
  echo "[supervisor] === Run #${run_count} starting at $(date -Iseconds) ==="

  set +e
  cd "$RUNNER_ROOT" && npm run dev -- run-all --skip-failed "$@" &
  runner_pid=$!

  start_watchdog

  wait "$runner_pid"
  exit_code=$?
  runner_pid=""
  set -e

  stop_watchdog

  if [ $exit_code -eq 0 ]; then
    echo "[supervisor] Runner exited 0 — all epics complete."
    exit 0
  fi

  consecutive_failures=$((consecutive_failures + 1))
  echo "[supervisor] Runner exited $exit_code (consecutive failures: $consecutive_failures/$MAX_CONSECUTIVE_FAILURES)"

  if [ $consecutive_failures -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
    echo "[supervisor] Max consecutive failures reached — giving up."
    exit 1
  fi

  echo "[supervisor] Waiting ${RETRY_DELAY}s before restart..."
  sleep "$RETRY_DELAY"
done
