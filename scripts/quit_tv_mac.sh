#!/bin/bash
# Quit TradingView Desktop on macOS (free RAM after agent chart work)
# Usage: ./scripts/quit_tv_mac.sh

set -euo pipefail

APP_BIN=""
for loc in \
  "/Applications/TradingView.app/Contents/MacOS/TradingView" \
  "$HOME/Applications/TradingView.app/Contents/MacOS/TradingView"
do
  if [ -f "$loc" ]; then
    APP_BIN="$loc"
    break
  fi
done

# Graceful quit
osascript -e 'tell application "TradingView" to quit' >/dev/null 2>&1 || true
sleep 1

# Match the binary with its launch arguments.
# Force leftover binary
if [ -n "$APP_BIN" ]; then
  PROCESS_PATTERN="^$(printf '%s' "$APP_BIN" | sed 's/[][\\.^$*+?(){}|]/\\&/g')( |$)"
  pkill -f "$PROCESS_PATTERN" 2>/dev/null || true
  sleep 0.5
  pkill -9 -f "$PROCESS_PATTERN" 2>/dev/null || true
else
  pkill -f "/TradingView[.]app/Contents/MacOS/TradingView( |$)" 2>/dev/null || true
  pkill -9 -f "/TradingView[.]app/Contents/MacOS/TradingView( |$)" 2>/dev/null || true
fi

if curl -s --max-time 1 "http://localhost:9222/json/version" >/dev/null 2>&1; then
  echo "Warning: CDP still responding on :9222"
  exit 1
fi

if pgrep -f "/TradingView[.]app/Contents/MacOS/TradingView( |$)" >/dev/null 2>&1; then
  echo "Warning: TradingView process still running"
  exit 1
fi

echo "TradingView quit (CDP down)"
exit 0
