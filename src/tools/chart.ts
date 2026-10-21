import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY } from './_format.js';
import * as core from '../core/chart.js';

export function registerChartTools(server: McpServer) {
  defineTool(server, {
    name: 'chart_get_state',
    description: 'Get current chart state (symbol, timeframe, chart type, indicators)',
    annotations: READ_ONLY,
    run: () => core.getState(),
  });

  defineTool(server, {
    name: 'chart_set_symbol',
    description: 'Change the chart symbol',
    inputSchema: {
      symbol: z.string().describe('Symbol to set (e.g., BTCUSD, AAPL, ES1!, NYMEX:CL1!)'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ symbol }) => core.setSymbol({ symbol }),
  });

  defineTool(server, {
    name: 'chart_set_timeframe',
    description: 'Change the chart timeframe/resolution',
    inputSchema: {
      timeframe: z.string().describe('Timeframe (e.g., 1, 5, 15, 60, D, W, M)'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ timeframe }) => core.setTimeframe({ timeframe }),
  });

  defineTool(server, {
    name: 'chart_set_type',
    description: 'Change chart type',
    inputSchema: {
      chart_type: z.enum(core.CHART_TYPE_NAMES).describe('Chart style name'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ chart_type }) => core.setType({ chart_type }),
  });

  defineTool(server, {
    name: 'chart_manage_indicator',
    description: 'Add or remove an indicator/study on the chart',
    inputSchema: {
      action: z.enum(['add', 'remove']).describe('Action: add or remove'),
      indicator: z.string().describe('Full indicator name: "Relative Strength Index", "MACD", "Volume", "Moving Average", "Bollinger Bands", "Moving Average Exponential". Short names like RSI/EMA do NOT work.'),
      entity_id: z.string().optional().describe('Entity ID to remove (from chart_get_state). Required for remove.'),
      inputs: z.string().optional().describe('JSON string of input overrides for the indicator (e.g., \'{"length": 20}\')'),
    },
    annotations: DESTRUCTIVE,
    run: ({ action, indicator, entity_id, inputs }) => core.manageIndicator({ action, indicator, entity_id, inputs }),
  });

  defineTool(server, {
    name: 'chart_get_visible_range',
    description: 'Get the visible date range (unix timestamps in seconds) and bars range on the chart',
    annotations: READ_ONLY,
    run: () => core.getVisibleRange(),
  });

  defineTool(server, {
    name: 'chart_set_visible_range',
    description: 'Zoom the chart to a specific date range (unix timestamps in seconds). Returns partially_loaded: true with the loaded from/to when only part of the range has loaded bars',
    inputSchema: {
      from: z.coerce.number().describe('Start of range, unix seconds'),
      to: z.coerce.number().describe('End of range, unix seconds'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ from, to }) => core.setVisibleRange({ from, to }),
  });

  defineTool(server, {
    name: 'chart_scroll_to_date',
    description: 'Jump the chart view to center on a specific date',
    inputSchema: {
      date: z.string().describe('ISO date string (e.g., "2024-01-15") or unix timestamp in seconds as a string'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ date }) => core.scrollToDate({ date }),
  });

  defineTool(server, {
    name: 'symbol_info',
    description: 'Get detailed metadata about the current symbol (name, exchange, type, description)',
    annotations: READ_ONLY,
    run: () => core.symbolInfo(),
  });

  defineTool(server, {
    name: 'symbol_search',
    description: 'Search for symbols by name or keyword',
    inputSchema: {
      query: z.string().describe('Search query (e.g., "AAPL", "crude oil", "ES")'),
      type: z.string().optional().describe('Filter by type (e.g., "stock", "futures", "crypto", "forex")'),
      exchange: z.string().optional().describe('Only symbols listed on this exchange (e.g., "NASDAQ", "BINANCE")'),
    },
    annotations: READ_ONLY,
    run: ({ query, type, exchange }) => core.symbolSearch({ query, type, exchange }),
  });
}
