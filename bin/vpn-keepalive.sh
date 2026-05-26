#!/usr/bin/env bash
#
# VPN keepalive — pings the VPN gateway every 30s via the tun interface.
# If 3 consecutive pings fail, reconnects the VPN via NetworkManager.
#
# Usage:  ./bin/vpn-keepalive.sh [--daemon]
#         --daemon: fork to background and write PID to /tmp/vpn-keepalive.pid
#
# Logs to stdout (or /tmp/vpn-keepalive.log in daemon mode).

set -euo pipefail

VPN_NAME="vpn-updataone"
PING_TARGET="192.168.104.89"
PING_INTERVAL=30
MAX_FAILURES=3
RECONNECT_COOLDOWN=60

LOGFILE="/tmp/vpn-keepalive.log"
PIDFILE="/tmp/vpn-keepalive.pid"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

check_vpn_active() {
  nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx "$VPN_NAME"
}

reconnect_vpn() {
  log "Bringing VPN down..."
  nmcli connection down "$VPN_NAME" 2>/dev/null || true
  sleep 5
  log "Bringing VPN up..."
  if nmcli connection up "$VPN_NAME" 2>/dev/null; then
    log "VPN reconnected successfully."
    sleep 10
  else
    log "ERROR: VPN reconnect failed. Will retry next cycle."
  fi
}

main() {
  log "VPN keepalive started for '$VPN_NAME' (ping $PING_TARGET every ${PING_INTERVAL}s, reconnect after $MAX_FAILURES failures)"

  local consecutive_failures=0

  while true; do
    if ! check_vpn_active; then
      log "VPN '$VPN_NAME' is not active. Reconnecting..."
      reconnect_vpn
      consecutive_failures=0
      sleep "$RECONNECT_COOLDOWN"
      continue
    fi

    if ping -c 1 -W 5 -I tun0 "$PING_TARGET" &>/dev/null; then
      if (( consecutive_failures > 0 )); then
        log "Ping recovered after $consecutive_failures failure(s)."
      fi
      consecutive_failures=0
    else
      consecutive_failures=$((consecutive_failures + 1))
      log "Ping failed ($consecutive_failures/$MAX_FAILURES)"

      if (( consecutive_failures >= MAX_FAILURES )); then
        log "VPN appears dead after $MAX_FAILURES consecutive ping failures. Reconnecting..."
        reconnect_vpn
        consecutive_failures=0
        sleep "$RECONNECT_COOLDOWN"
        continue
      fi
    fi

    sleep "$PING_INTERVAL"
  done
}

if [[ "${1:-}" == "--daemon" ]]; then
  main >> "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  echo "VPN keepalive daemonized (PID $(cat "$PIDFILE"), log: $LOGFILE)"
else
  main
fi
