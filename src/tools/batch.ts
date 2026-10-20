import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, WRITE } from './_format.js';
import * as core from '../core/batch.js';

export function registerBatchTools(server: McpServer) {
  defineTool(server, {
    name: 'batch_run',
    description: 'Run an action across multiple symbols and/or timeframes. Restores the original symbol and timeframe afterwards; success is false if any iteration failed.',
    inputSchema: {
      symbols: z.array(z.string()).describe('Array of symbols to iterate (e.g., ["BTCUSD", "ETHUSD", "AAPL"])'),
      timeframes: z.array(z.string()).optional().describe('Array of timeframes (e.g., ["D", "60", "15"])'),
      action: z.enum(core.BATCH_ACTIONS).describe('Action to run on each symbol/timeframe. get_ohlcv returns the same summary as data_get_ohlcv summary=true.'),
      delay_ms: z.coerce.number().optional().describe('Delay after each chart change in ms (default 2000, 0 allowed)'),
      ohlcv_count: z.coerce.number().optional().describe('Bar count for get_ohlcv action (default 100)'),
    },
    annotations: WRITE,
    run: ({ symbols, timeframes, action, delay_ms, ohlcv_count }) => core.batchRun({ symbols, timeframes, action, delay_ms, ohlcv_count }),
  });
}
