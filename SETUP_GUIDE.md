# Setup Guide for Claude Code

This file is a step-by-step guide for Claude Code (or any LLM agent) to install and configure the TradingView MCP server. If a user asks you to install or set up this project, follow these steps exactly.

## Step 1: Clone and Install

```bash
git clone https://github.com/wezzcoetzee/tradingview-mcp.git ~/tradingview-mcp
cd ~/tradingview-mcp
bun install
```

If the user specifies a different install path, use that instead of `~/tradingview-mcp`.

## Step 2: Add to MCP Config

Register the server at user scope (stored in `~/.claude.json`, available in every project):

```bash
claude mcp add --scope user tradingview -- "$(which bun)" "<INSTALL_PATH>/src/server.ts"
```

Replace `<INSTALL_PATH>` with the actual path where the repo was cloned (e.g., `/Users/username/tradingview-mcp`).

The `bun` path must be absolute. MCP clients launch servers in a non-interactive shell where `bun` is often not on PATH, so `"$(which bun)"` (typically `~/.bun/bin/bun`) is resolved now and stored in the config. Node cannot run the `.ts` entrypoint.

To edit the config by hand instead, add this under `mcpServers` in `~/.claude.json`, merging with any existing servers:

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "/Users/username/.bun/bin/bun",
      "args": ["/Users/username/tradingview-mcp/src/server.ts"]
    }
  }
}
```

Verify with `claude mcp list`.

## Step 3: Launch TradingView Desktop

TradingView Desktop must be running with Chrome DevTools Protocol enabled.

**Auto-detect and launch (recommended):**
After the MCP server is connected, use the `tv_launch` tool — it auto-detects TradingView on Mac, Windows, and Linux.

**Manual launch by platform:**

Mac:
```bash
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222
```

Windows:
```bash
%LOCALAPPDATA%\TradingView\TradingView.exe --remote-debugging-port=9222
```

Linux:
```bash
/opt/TradingView/tradingview --remote-debugging-port=9222
# or: tradingview --remote-debugging-port=9222
```

## Step 4: Restart Claude Code

The MCP server only loads when Claude Code starts. After adding the config:

1. Exit Claude Code (Ctrl+C)
2. Relaunch Claude Code
3. The tradingview MCP server should connect automatically

## Step 5: Verify Connection

Use the `tv_health_check` tool. Expected response:

```json
{
  "success": true,
  "cdp_connected": true,
  "chart_symbol": "...",
  "api_available": true
}
```

If `cdp_connected: false`, TradingView is not running with `--remote-debugging-port=9222`.

## Step 6: Install CLI (Optional)

To use the `tv` CLI command globally:

```bash
cd ~/tradingview-mcp
bun link
```

Then `tv status`, `tv quote`, `tv pine compile`, etc. work from anywhere.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `cdp_connected: false` | Launch TradingView with `--remote-debugging-port=9222` |
| `ECONNREFUSED` | TradingView isn't running or port 9222 is blocked |
| MCP server fails to start, `bun: command not found` | Re-run `claude mcp add` using the absolute bun path from `which bun` |
| MCP server not showing in Claude Code | Run `claude mcp list`, check `~/.claude.json` syntax, restart Claude Code |
| Port 9222 already in use | Another process holds the port. Quit it, or set `TV_CDP_PORT` (server and TradingView must match) |
| TradingView running but not on port 9222 (macOS) | A TradingView started without the flag is still running. Quit it fully (Cmd+Q) and relaunch, or use `tv_launch` with `kill_existing: true` |
| Tools act on the wrong chart | Multiple tabs open. Use `tab_list` and `tab_switch` to target the right one |
| `ui_evaluate` is disabled | Intentional. Requires `TRADINGVIEW_MCP_ALLOW_EVAL=1` and `TRADINGVIEW_MCP_CONFIRM_EVAL=1`. See README Security |
| `tv` command not found | Run `bun link` from the project directory, or use `bun run tv <command>` |
| Tools return stale data | TradingView may still be loading — wait a few seconds |
| Pine Editor tools fail | Open the Pine Editor panel first (`ui_open_panel pine-editor open`) |

## What to Read Next

- `CLAUDE.md` — Decision tree for which tool to use when (auto-loaded by Claude Code)
- `README.md` — Full tool reference (MCP tools and CLI commands)
- `RESEARCH.md` — Research context and open questions
