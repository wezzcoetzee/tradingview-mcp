---
name: pine-develop
description: Full Pine Script development loop — write code, compile, fix errors, iterate. Use when building a new indicator or strategy in TradingView.
---

# Pine Script Development Loop

You are developing a Pine Script indicator or strategy in TradingView. Follow this loop precisely. All steps use MCP tools — no shell scripts.

## Step 1: Understand the Goal

If not already clear, ask the user:
- What type? (indicator, strategy, library)
- What does it do? (entry/exit logic, overlay, oscillator, etc.)
- Overlay or separate pane?
- Any specific inputs or visual elements?

## Step 2: Pull Current Source (if modifying)

If modifying an existing script in the Pine Editor:

- `pine_get_source` — read the current code

> Warning: `pine_get_source` can return 200KB+ for complex scripts. Skip it if you already know the code or are starting fresh.

If creating new: skip to Step 3, optionally seeding with `pine_new` for a blank `indicator`/`strategy`/`library`.

## Step 3: Write the Pine Script

Write the complete script. Every script MUST include:
- `//@version=6` header
- Proper `indicator()` or `strategy()` declaration
- All user inputs with `input.*()` functions and groups
- Clear comments for each logical section

For strategies, include:
- `strategy.entry()` and `strategy.exit()` calls
- Position sizing via `strategy()` declaration
- Default commission and slippage settings

## Step 4: Inject and Compile

- `pine_set_source` — inject the source into the Pine Editor
- `pine_smart_compile` — compile with auto-detection and error check

This is the canonical write+compile cycle. `pine_smart_compile` returns the error/warning list directly.

## Step 5: Fix Errors

If errors are reported:
1. Read each error (line number + description) — also check `pine_get_errors` for the structured list and `pine_get_console` for any `log.info()` output
2. Edit the script
3. `pine_set_source` + `pine_smart_compile` again
4. Repeat until 0 errors

Common Pine Script errors:
- **"Mismatched input"** — usually indentation (Pine uses 4-space indentation, not braces)
- **"Could not find function or function reference"** — typo in function name or wrong version
- **"Undeclared identifier"** — variable used before declaration
- **"Cannot call X with argument type Y"** — wrong parameter type

## Step 6: Verify on Chart

After clean compilation:
1. `capture_screenshot` — take a screenshot to verify it looks right
2. `data_get_strategy_results` — if it's a strategy, check performance
3. `data_get_pine_lines` / `data_get_pine_labels` / `data_get_pine_tables` / `data_get_pine_boxes` — if the script draws levels, labels, tables, or zones, read them back to confirm the data is what you expect
4. Show the user the results

## Step 7: Save (optional)

If the user wants to keep the script in their TradingView cloud:

- `pine_save` — save the current editor contents under a name

## Step 8: Iterate

If the user wants changes:
1. Edit the source in your context
2. `pine_set_source` + `pine_smart_compile`
3. Screenshot to verify

IMPORTANT: Always compile after every change. Never claim "done" without a clean compile.
