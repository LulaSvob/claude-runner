#!/usr/bin/env bash
#
# Supervisor wrapper for claude-runner run-all.
# Restarts the runner on exit until all epics complete (exit 0).
# Handles transient crashes, OOM kills, and unhandled errors.
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

consecutive_failures=0
run_count=0

cleanup() {
  echo ""
  echo "[supervisor] Caught signal — shutting down."
  exit 130
}
trap cleanup SIGINT SIGTERM

echo "[supervisor] Starting claude-runner supervisor"
echo "[supervisor] Runner root: $RUNNER_ROOT"
echo "[supervisor] Args: $*"
echo "[supervisor] Retry delay: ${RETRY_DELAY}s, max consecutive failures: ${MAX_CONSECUTIVE_FAILURES}"
echo ""

while true; do
  run_count=$((run_count + 1))
  echo "[supervisor] === Run #${run_count} starting at $(date -Iseconds) ==="

  set +e
  cd "$RUNNER_ROOT" && npm run dev -- run-all --skip-failed "$@"
  exit_code=$?
  set -e

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
