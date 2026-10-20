import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/watchlist.js';

export function registerWatchlistTools(server: McpServer) {
  defineTool(server, {
    name: 'watchlist_get',
    description: 'Get all symbols from the current TradingView watchlist with last price, change, and change%',
    annotations: READ_ONLY,
    run: () => core.get(),
  });

  defineTool(server, {
    name: 'watchlist_add',
    description: 'Add a symbol to the TradingView watchlist',
    inputSchema: {
      symbol: z.string().describe('Symbol to add (e.g., AAPL, BTCUSD, ES1!, NYMEX:CL1!)'),
    },
    annotations: WRITE,
    run: ({ symbol }) => core.add({ symbol }),
    onError: async (error) => {
      // Try to close any open search/input on error
      try {
        const { getClient } = await import('../connection.js');
        const c = await getClient();
        await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      } catch (_) {}
      return { success: false, error };
    },
  });
}
