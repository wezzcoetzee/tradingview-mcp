import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, zBool, READ_ONLY } from './_format.js';
import * as core from '../core/data.js';

export function registerDataTools(server: McpServer) {
  defineTool(server, {
    name: 'data_get_ohlcv',
    description: 'Get OHLCV bar data from the chart. Use summary=true for compact stats instead of all bars (saves context).',
    inputSchema: {
      count: z.coerce.number().optional().describe('Number of bars to retrieve (max 500, default 100)'),
      summary: zBool.optional().describe('Return summary stats (high, low, open, close, avg volume, range) instead of all bars — much smaller output'),
    },
    annotations: READ_ONLY,
    run: ({ count, summary }) => core.getOhlcv({ count, summary }),
  });

  defineTool(server, {
    name: 'data_get_indicator',
    description: 'Get indicator/study info and input values',
    inputSchema: {
      entity_id: z.string().describe('Study entity ID (from chart_get_state)'),
    },
    annotations: READ_ONLY,
    run: ({ entity_id }) => core.getIndicator({ entity_id }),
  });

  defineTool(server, {
    name: 'data_get_strategy_results',
    description: 'Get strategy performance metrics from Strategy Tester',
    annotations: READ_ONLY,
    run: () => core.getStrategyResults(),
  });

  defineTool(server, {
    name: 'data_get_trades',
    description: 'Get trade list from Strategy Tester',
    inputSchema: {
      max_trades: z.coerce.number().optional().describe('Maximum trades to return'),
    },
    annotations: READ_ONLY,
    run: ({ max_trades }) => core.getTrades({ max_trades }),
  });

  defineTool(server, {
    name: 'data_get_equity',
    description: 'Get equity curve data from Strategy Tester',
    annotations: READ_ONLY,
    run: () => core.getEquity(),
  });

  defineTool(server, {
    name: 'quote_get',
    description: 'Get real-time quote data for a symbol (price, OHLC, volume)',
    inputSchema: {
      symbol: z.string().optional().describe('Symbol to quote (blank = current chart symbol)'),
    },
    annotations: READ_ONLY,
    run: ({ symbol }) => core.getQuote({ symbol }),
  });

  defineTool(server, {
    name: 'depth_get',
    description: 'Get order book / DOM (Depth of Market) data from the chart',
    annotations: READ_ONLY,
    run: () => core.getDepth(),
    onError: (error) => ({ success: false, error, hint: 'Open the DOM panel in TradingView before using this tool.' }),
  });

  defineTool(server, {
    name: 'data_get_pine_lines',
    description: 'Read horizontal price levels drawn by Pine Script indicators (line.new). Returns deduplicated price levels per study. Use study_filter to target a specific indicator.',
    inputSchema: {
      study_filter: z.string().optional().describe('Substring to match study name (e.g., "Profiler", "NY Levels"). Omit for all.'),
      verbose: zBool.optional().describe('Return raw line data with IDs, coordinates, colors (default false — returns only unique price levels)'),
    },
    annotations: READ_ONLY,
    run: ({ study_filter, verbose }) => core.getPineLines({ study_filter, verbose }),
  });

  defineTool(server, {
    name: 'data_get_pine_labels',
    description: 'Read text labels drawn by Pine Script indicators (label.new). Returns text and price pairs. Use study_filter to target a specific indicator.',
    inputSchema: {
      study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
      max_labels: z.coerce.number().optional().describe('Max labels per study (default 50). Set higher if you need all.'),
      verbose: zBool.optional().describe('Return raw label data with IDs, colors, positions (default false — returns only text + price)'),
    },
    annotations: READ_ONLY,
    run: ({ study_filter, max_labels, verbose }) => core.getPineLabels({ study_filter, max_labels, verbose }),
  });

  defineTool(server, {
    name: 'data_get_pine_tables',
    description: 'Read table data drawn by Pine Script indicators (table.new). Returns formatted text rows per table. Use study_filter to target a specific indicator.',
    inputSchema: {
      study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    },
    annotations: READ_ONLY,
    run: ({ study_filter }) => core.getPineTables({ study_filter }),
  });

  defineTool(server, {
    name: 'data_get_pine_boxes',
    description: 'Read box/zone boundaries drawn by Pine Script indicators (box.new). Returns deduplicated {high, low} price zones. Use study_filter to target a specific indicator.',
    inputSchema: {
      study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
      verbose: zBool.optional().describe('Return all boxes with IDs and coordinates (default false — returns unique price zones)'),
    },
    annotations: READ_ONLY,
    run: ({ study_filter, verbose }) => core.getPineBoxes({ study_filter, verbose }),
  });

  defineTool(server, {
    name: 'data_get_study_values',
    description: 'Get current indicator values from the data window for all visible studies (RSI, MACD, Bollinger Bands, EMAs, custom indicators with plot()).',
    annotations: READ_ONLY,
    run: () => core.getStudyValues(),
  });
}
