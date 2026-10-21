import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, IDEMPOTENT_WRITE, READ_ONLY } from './_format.js';
import * as core from '../core/pane.js';

export function registerPaneTools(server: McpServer) {
  defineTool(server, {
    name: 'pane_list',
    description: 'List all chart panes in the current layout with their symbols and active state',
    annotations: READ_ONLY,
    run: () => core.list(),
  });

  defineTool(server, {
    name: 'pane_set_layout',
    description: 'Change the chart grid layout (codes such as s, 2h, 2v, 4, 6, 8; the schema lists them all)',
    inputSchema: {
      layout: z.enum(core.LAYOUT_INPUTS).describe('Layout code (s = single, 4 = 2x2 grid, 2h/2v = two side by side or stacked) or alias such as single, 2x2, quad'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ layout }) => core.setLayout({ layout }),
  });

  defineTool(server, {
    name: 'pane_focus',
    description: 'Focus a specific chart pane by index (0-based)',
    inputSchema: {
      index: z.coerce.number().describe('Pane index (0-based, from pane_list)'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ index }) => core.focus({ index }),
  });

  defineTool(server, {
    name: 'pane_set_symbol',
    description: 'Set the symbol on a specific pane by index',
    inputSchema: {
      index: z.coerce.number().describe('Pane index (0-based)'),
      symbol: z.string().describe('Symbol to set (e.g., NQ1!, ES1!, AAPL)'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ index, symbol }) => core.setSymbol({ index, symbol }),
  });
}
