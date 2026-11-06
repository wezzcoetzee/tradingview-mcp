/** Server instructions shown to MCP clients. tests/server.test.ts checks that every registered tool is named here. */
export const INSTRUCTIONS = `TradingView MCP: read and control a live TradingView Desktop chart.

Times are unix seconds unless a parameter name ends in _ms. Pass full indicator names ("Relative Strength Index", not "RSI").

Start: chart_get_state once (symbol, timeframe, indicator entity IDs). tv_health_check checks the connection; tv_launch starts TradingView with CDP; tv_discover and tv_ui_state are diagnostics. The first unreachable CDP connection auto-launches once unless TV_MCP_AUTO_LAUNCH=0. Call tv_quit after completing chart work unless the user asks to keep TradingView open; keep it open across symbols within one request.

window_hidden: true (screen locked or TradingView minimized) means the on-screen legend and window pixels are stale while the chart API is current. Trust API data; capture_screenshot then renders from the chart model by default (method "snapshot"). tab_new refuses while hidden: work in the current tab and restore its symbol and timeframe afterwards.

Read the chart:
- data_get_study_series (loaded historical numeric plots by entity_id, exact timestamps, null when unavailable), chart_get_analysis_snapshot (guarded compact model evidence with capture interval and partial sections; feed freshness/delay/candle confirmation can be unknown)
- quote_get (price snapshot), data_get_ohlcv (ALWAYS summary=true unless you need single bars), data_get_study_values (all visible indicators), data_get_indicator (inputs of one study), depth_get (order book)
- Custom Pine drawings, always with study_filter and visible indicators: data_get_pine_lines (levels), data_get_pine_labels, data_get_pine_tables, data_get_pine_boxes (zones). Never verbose=true unless asked.
- History: data_load_history (bounded navigation, coverage is not completeness), data_get_ohlcv_page (500 bars/page; use next_before).
- Strategy Tester: data_get_strategy_results, data_get_trades, data_get_equity
- symbol_info, symbol_search, watchlist_get, layout_list, capture_screenshot (inline=true returns the image itself)

Change the chart: chart_set_symbol, chart_set_timeframe, chart_set_type, chart_manage_indicator, indicator_set_inputs, indicator_toggle_visibility, chart_scroll_to_date, chart_set_visible_range (chart_get_visible_range reads it), watchlist_add, layout_switch.
Panes: pane_list, pane_set_layout, pane_focus, pane_set_symbol. Tabs: tab_list, tab_new, tab_close, tab_switch.
Many symbols or timeframes: batch_run (study values/Pine drawings/collect_analysis plus existing actions; bounded summaries, study_filter; reports symbol/timeframe/range restoration failures and progress).

Pine Script: pine_set_source, then pine_smart_compile (the default compile; pine_compile is a raw button click), pine_get_errors, pine_get_console, pine_save. pine_get_source can be huge: use from_line/to_line. pine_new and pine_open replace the editor. pine_list_scripts lists saved scripts. pine_analyze (offline lint) and pine_check (server compile) take a source argument and ignore the editor.

Replay: replay_start, replay_step, replay_jump, replay_autoplay, replay_trade, replay_status, replay_stop.
Drawings: draw_shape, draw_list, draw_get_properties, draw_remove_one, draw_clear. Alerts: alert_create, alert_list, alert_delete. alert_create refuses unavailable exact controls and reports unverified creation when list fields cannot prove the requested configuration.
Process-local watches: watch_start, watch_events, watch_stop. Only watch_events samples, with bounded retention and TTL. Clients (including Hermes) must schedule/resume themselves; this server cannot wake them. Use returned cursor and check dropped/stopped. Crossings between samples can be missed. TradingView alerts persist independently; watches do not.
UI automation (last resort): ui_open_panel, ui_fullscreen, ui_click, ui_find_element, ui_hover, ui_scroll, ui_mouse_click, ui_keyboard, ui_type_text. ui_evaluate exists only when TRADINGVIEW_MCP_ALLOW_EVAL=1.

Workflows are also offered as prompts (pine-develop, multi-symbol-scan, replay-practice, strategy-report, swing-trader-chart-analysis, position-chart-analysis).`;
