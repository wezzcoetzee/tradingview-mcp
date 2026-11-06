import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, READ_ONLY, WRITE } from './_format.js';
import { getOhlcvPage, loadHistory } from '../core/history.js';

export function registerHistoryTools(server: McpServer) {
  defineTool(server, {
    name: 'data_load_history',
    description: 'Attempt bounded historical loading via chart navigation, restoring the visible range. Reports actual coverage, partial/exhausted/timeout/unsupported states. Range endpoints never prove all bars exist. Exhausted means attempts stalled, not verified source exhaustion.',
    inputSchema: {
      from: z.coerce.number().optional(),
      to: z.coerce.number().optional(),
      count: z.coerce.number().int().min(1).max(100000).optional(),
      max_attempts: z.coerce.number().int().min(1).max(50).optional(),
      timeout_ms: z.coerce.number().int().min(1).max(60000).optional(),
      poll_ms: z.coerce.number().int().min(0).max(2000).optional(),
    },
    annotations: WRITE,
    run: params => loadHistory(params),
  });
  defineTool(server, {
    name: 'data_get_ohlcv_page',
    description: 'Read already-loaded OHLCV in bounded pages of at most 500 bars, ascending within each page. Pass next_before as before for the previous page. Does not load history. Keep symbol/timeframe fixed across pages; live data is not a snapshot.',
    inputSchema: {
      from: z.coerce.number().optional(),
      to: z.coerce.number().optional(),
      before: z.coerce.number().optional(),
      count: z.coerce.number().int().min(1).max(500).optional(),
    },
    annotations: READ_ONLY,
    run: params => getOhlcvPage(params),
  });
}
