#!/bin/bash
# Launch TradingView Desktop on Linux with Chrome DevTools Protocol enabled
# Usage: ./scripts/launch_tv_debug_linux.sh [port]

PORT="${1:-9222}"

# Redirect app output to a log file. TradingView spams console.debug; with the
# launching shell's pipe as stdout, the next write after that shell exits is a
# broken pipe (EPIPE) and crashes the app.
LOG_DIR="$HOME/.local/share/tradingview-mcp"
LOG_FILE="$LOG_DIR/launch-tv-$PORT.log"
mkdir -p "$LOG_DIR"

# Auto-detect TradingView install location
APP=""
LOCATIONS=(
  "/opt/TradingView/tradingview"
  "/opt/TradingView/TradingView"
  "$HOME/.local/share/TradingView/TradingView"
  "/usr/bin/tradingview"
  "/usr/local/bin/tradingview"
  "/snap/tradingview/current/tradingview"
  "/var/lib/flatpak/app/com.tradingview.TradingView/current/active/files/bin/tradingview"
  "$HOME/.local/share/flatpak/app/com.tradingview.TradingView/current/active/files/bin/tradingview"
)

for loc in "${LOCATIONS[@]}"; do
  if [ -f "$loc" ] && [ -x "$loc" ]; then
    APP="$loc"
    break
  fi
done

# Fallback: flatpak (system or per-user install). The bundle's bin wrapper
# hardcodes the in-sandbox path /app/..., so the binary must be launched via
# `flatpak run` — never directly. Detect by app id, case-insensitively.
FLATPAK_APP_ID=""
if [ -z "$APP" ] && command -v flatpak >/dev/null 2>&1; then
  FLATPAK_APP_ID=$(flatpak list --app --columns=application 2>/dev/null | grep -i tradingview | head -1)
fi

# Fallback: which / whereis
if [ -z "$APP" ]; then
  APP=$(which tradingview 2>/dev/null || which TradingView 2>/dev/null)
fi

# Fallback: find in common dirs
if [ -z "$APP" ]; then
  APP=$(find /opt /usr/local /snap /var/lib/flatpak "$HOME/.local" -type f -executable \( -name "tradingview" -o -name "TradingView" \) 2>/dev/null | head -1)
fi

# A found flatpak bundle binary is not directly executable (wrapper expects
# the /app sandbox mount) — prefer launching through flatpak.
FLATPAK_LAUNCH=""
if [ -n "$FLATPAK_APP_ID" ]; then
  case "$APP" in
    "") FLATPAK_LAUNCH=1 ;;
    */flatpak/*) FLATPAK_LAUNCH=1 ;;
  esac
fi

if [ -n "$FLATPAK_LAUNCH" ]; then
  echo "Found flatpak app: $FLATPAK_APP_ID"
  # Inside the sandbox the app runs as /app/extra/msedge (Electron), so
  # pkill -x tradingview never matches flatpak processes — kill by path.
  pkill -f '/app/extra/msedge' 2>/dev/null
  pkill -x -i tradingview 2>/dev/null
  sleep 1
  echo "Launching via flatpak with --remote-debugging-port=$PORT (log: $LOG_FILE) ..."
  flatpak run "$FLATPAK_APP_ID" --remote-debugging-port="$PORT" > "$LOG_FILE" 2>&1 &
  TV_PID=$!
  echo "PID: $TV_PID"

  for i in $(seq 1 15); do
    if curl -s -m 2 "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
      echo "CDP ready at http://localhost:$PORT"
      curl -s -m 2 "http://localhost:$PORT/json/version" | python3 -m json.tool 2>/dev/null || curl -s -m 2 "http://localhost:$PORT/json/version"
      exit 0
    fi
    sleep 1
  done

  echo "Warning: CDP not responding after 15s. TradingView may still be loading."
  exit 0
fi

if [ -z "$APP" ] || [ ! -f "$APP" ]; then
  echo "Error: TradingView not found."
  echo "Checked: /opt/TradingView, ~/.local/share/TradingView, snap, flatpak, PATH"
  echo ""
  echo "If installed elsewhere, run manually:"
  echo "  /path/to/tradingview --remote-debugging-port=$PORT"
  exit 1
fi

# Kill any existing TradingView by exact process name (pkill -f would also match
# the MCP server running from the tradingview-mcp repo)
pkill -x -i tradingview 2>/dev/null
sleep 1

echo "Found TradingView at: $APP"
echo "Launching with --remote-debugging-port=$PORT (log: $LOG_FILE) ..."
"$APP" --remote-debugging-port=$PORT > "$LOG_FILE" 2>&1 &
TV_PID=$!
echo "PID: $TV_PID"

# Wait for CDP to be ready
echo "Waiting for CDP..."
for i in $(seq 1 15); do
  if curl -s -m 2 "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
    echo "CDP ready at http://localhost:$PORT"
    curl -s -m 2 "http://localhost:$PORT/json/version" | python3 -m json.tool 2>/dev/null || curl -s -m 2 "http://localhost:$PORT/json/version"
    exit 0
  fi
  sleep 1
done

echo "Warning: CDP not responding after 15s. TradingView may still be loading."
