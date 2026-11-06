import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, WRITE } from './_format.js';
import * as core from '../core/batch.js';

export function registerBatchTools(server: McpServer) {
  defineTool(server, {
    name: 'batch_run',
    description: 'Run an action across multiple symbols and/or timeframes (one iteration per symbol and timeframe pair; slow, so it sends progress notifications when the client asks for them). Attempts to restore the original symbol, timeframe and visible range, reporting restoration status; success is false if any iteration failed.',
    inputSchema: {
      symbols: z.array(z.string()).describe('Array of symbols to iterate (e.g., ["BTCUSD", "ETHUSD", "AAPL"])'),
      timeframes: z.array(z.string()).optional().describe('Array of timeframes (e.g., ["D", "60", "15"])'),
      action: z.enum(core.BATCH_ACTIONS).describe('Action to run on each symbol/timeframe. get_ohlcv returns the same summary as data_get_ohlcv summary=true.'),
      study_filter: z.string().optional().describe('Study name substring for Pine and study-value collections'),
      max_items: z.coerce.number().int().min(1).max(50).optional().describe('Collection array cap, default 20; up to 50 object keys, 500 characters/string, approximate 24K-character budget per collection'),
      delay_ms: z.coerce.number().optional().describe('Delay after each chart change, in milliseconds (default 2000, 0 allowed)'),
      ohlcv_count: z.coerce.number().optional().describe('Bar count for get_ohlcv action (default 100)'),
    },
    annotations: WRITE,
    run: ({ symbols, timeframes, action, delay_ms, ohlcv_count, study_filter, max_items }, { progress }) => core.batchRun({ symbols, timeframes, action, delay_ms, ohlcv_count, study_filter, max_items, onProgress: progress }),
  });
}
