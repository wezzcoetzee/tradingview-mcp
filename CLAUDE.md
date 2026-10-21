# TradingView MCP — Claude Instructions

Tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for the active chart symbol (errors if `symbol` differs; `chart_set_symbol` first)

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15"); `success:false` with `expected`/`seen` if the chart did not settle there; `partially_loaded: true` (plus loaded `from`/`to`) if only part of the window has loaded bars
- `chart_set_visible_range` → zoom to exact date range (unix seconds, not milliseconds); same `success:false` (`expected`/`seen`) and `partially_loaded` behaviour

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → the default compile (`pine_compile` is a raw button click with no error report); `has_errors` counts severity 8 only, `warnings` are listed apart, and `compile_confirmed: false` means the markers may be from the previous compile
3. `pine_get_errors` → read markers (`errors` vs `warnings`, each with `severity`)
4. `pine_get_console` → read log.info() output (deduplicated, newest 50 by default; `limit` to change)
5. `pine_get_source` → read current code back (WARNING: can be very large; use `from_line`/`to_line`/`max_chars`, `total_lines` tells you the size)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → replace the editor with a blank indicator/strategy/library (refuses if a saved script is open unless `replace_current: true`)
8. `pine_open` → load a saved script by name into the editor (same `replace_current` guard); `pine_list_scripts` lists saved scripts
9. `pine_analyze` (offline lint) and `pine_check` (server-side compile, a network call) take a `source` argument and ignore the editor

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance bars (`count` up to 500; returns `advanced`); `replay_jump` with `date` → move to another date mid-replay
3. `replay_autoplay` → `enabled: true/false` for an explicit state (omit to flip), `speed` in ms
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"`, `"get_ohlcv"` (summary) or `"get_strategy_results"`; restores the original symbol/timeframe
- Progress notifications are sent when the client provides a progress token (`batch_run`, and per bar in `replay_step`)
- `data_get_trades` returns the latest trades with `total`; pass `offset` to page from the oldest

### "Strategy Tester"
- `data_get_strategy_results` → performance metrics; `data_get_trades` → trade list; `data_get_equity` → equity curve (`max_points`, summary)

### "Panes, tabs, watchlist, symbols"
- `pane_list`, `pane_set_layout`, `pane_focus`, `pane_set_symbol` → multi-chart grids
- `tab_list`, `tab_new`, `tab_close`, `tab_switch` → chart tabs
- `watchlist_get`, `watchlist_add`; `symbol_info` (current symbol), `symbol_search` (find tickers); `layout_list`, `layout_switch`
- `indicator_set_inputs`, `indicator_toggle_visibility` → tweak studies already on the chart

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2, times in unix seconds; `more_points` for channels/pitchforks/fib, `lock: true` to lock)
- `draw_list` → see what's drawn, with points
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition is set in the TradingView dialog; returns `alert_id` once confirmed in `alert_list`)
- `alert_list` → view active alerts
- `alert_delete` → remove alerts by `alert_id` (from `alert_list`) or `delete_all: true`; verified by re-listing

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `ui_find_element`, `ui_hover`, `ui_scroll`, `ui_mouse_click`, `ui_keyboard`, `ui_type_text` → lower-level UI automation, last resort
- `capture_screenshot` → take a screenshot (regions: "full" (default), "chart", "strategy_tester"; `inline: true` also returns the image; `region_fallback: true` means the region was not found and the full window was captured)

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux (returns `already_running` if CDP is up; pass `kill_existing: true` if TradingView is open without CDP). Other tools then use its port
- `tv_health_check` → verify connection is working

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Read a range with `from_line`/`to_line`/`max_chars`; `data_get_equity` takes `max_points` or `summary: true`.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (file path only; `inline: true` adds the ~300KB image) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `TV_MCP_SCREENSHOT_DIR` (default: `tradingview-mcp-screenshots` in the OS temp dir) with timestamps
- The `skills/` workflows are also served as MCP prompts; their names match the directory names
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (127.0.0.1:9222, override with TV_CDP_PORT) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`

### TradingView lifecycle

- The first unreachable CDP connection attempts `tv_launch` once per MCP process. Set `TV_MCP_AUTO_LAUNCH=0` to disable it.
- Existing instances without CDP require explicit `tv_launch` with `kill_existing: true`; on macOS this uses `scripts/launch_tv_debug_mac.sh`.
- Call `tv_quit` once chart work is complete unless the user asks to keep TradingView open. Keep it open across multi-symbol work within one request.
- `tv_quit` can restrict shutdown to sessions this MCP process launched with `only_if_agent_launched: true`. Successful shutdown allows the next chart request to auto-launch again.
- Manual macOS shutdown: `./scripts/quit_tv_mac.sh`.
