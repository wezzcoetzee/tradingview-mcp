#!/bin/bash
# Launch TradingView Desktop on macOS with Chrome DevTools Protocol enabled
# Usage: ./scripts/launch_tv_debug_mac.sh [port]

PORT="${1:-9222}"

# Auto-detect TradingView install location
APP=""
LOCATIONS=(
  "/Applications/TradingView.app/Contents/MacOS/TradingView"
  "$HOME/Applications/TradingView.app/Contents/MacOS/TradingView"
)

for loc in "${LOCATIONS[@]}"; do
  if [ -f "$loc" ]; then
    APP="$loc"
    break
  fi
done

# Fallback: search with mdfind (Spotlight)
if [ -z "$APP" ]; then
  APP=$(mdfind "kMDItemCFBundleIdentifier == 'com.niceincontact.TradingView'" 2>/dev/null | head -1)
  if [ -n "$APP" ]; then
    APP="$APP/Contents/MacOS/TradingView"
  fi
fi

# Fallback: find any TradingView.app
if [ -z "$APP" ] || [ ! -f "$APP" ]; then
  APP=$(find /Applications "$HOME/Applications" -name "TradingView.app" -maxdepth 2 2>/dev/null | head -1)
  if [ -n "$APP" ]; then
    APP="$APP/Contents/MacOS/TradingView"
  fi
fi

if [ -z "$APP" ] || [ ! -f "$APP" ]; then
  echo "Error: TradingView not found."
  echo "Checked: /Applications/TradingView.app, ~/Applications/TradingView.app"
  echo ""
  echo "If installed elsewhere, run manually:"
  echo "  /path/to/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=$PORT"
  exit 1
fi

APP_BUNDLE="${APP%/Contents/MacOS/TradingView}.app"
# Kill the entire app process tree (main executable + Chromium helpers).
# Exact matching of only "$APP" misses the trailing CDP args and leaves stale
# helper processes behind, so match commands rooted inside this app bundle.
PROCESS_PATTERN="^${APP_BUNDLE//\//\\/}/"
PIDS=$(pgrep -f "$PROCESS_PATTERN" 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  while IFS= read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done <<< "$PIDS"
  for i in $(seq 1 10); do
    REMAINING=$(pgrep -f "$PROCESS_PATTERN" 2>/dev/null || true)
    [ -z "$REMAINING" ] && break
    sleep 1
  done
  REMAINING=$(pgrep -f "$PROCESS_PATTERN" 2>/dev/null || true)
  if [ -n "$REMAINING" ]; then
    while IFS= read -r pid; do
      [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
    done <<< "$REMAINING"
    sleep 1
  fi
fi

echo "Found TradingView at: $APP"
echo "Launching via LaunchServices with --remote-debugging-port=$PORT ..."
# TradingView Desktop's macOS Electron 38 wrapper can hang CDP requests when
# its inner Mach-O is spawned directly. Launch the app bundle and pass flags via
# LaunchServices instead. The prior process cleanup above ensures this is fresh.
open -a "$APP_BUNDLE" --args "--remote-debugging-port=$PORT" >/dev/null 2>&1 &
TV_PID=$!
echo "Launcher PID: $TV_PID"

# Wait for CDP to be ready
echo "Waiting for CDP..."
for i in $(seq 1 15); do
  if curl --connect-timeout 1 --max-time 2 -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "CDP ready at http://localhost:$PORT"
    curl -s "http://localhost:$PORT/json/version" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:$PORT/json/version"
    exit 0
  fi
  sleep 1
done

echo "Warning: CDP not responding after 15s. TradingView may still be loading."
echo "Check manually: curl http://localhost:$PORT/json/version"
