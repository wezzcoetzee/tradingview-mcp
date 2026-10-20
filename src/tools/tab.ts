import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/tab.js';

export function registerTabTools(server: McpServer) {
  defineTool(server, {
    name: 'tab_list',
    description: 'List all open TradingView chart tabs; active marks the tab other tools act on',
    annotations: READ_ONLY,
    run: () => core.list(),
  });

  defineTool(server, {
    name: 'tab_new',
    description: 'Open a new chart tab and switch to it; new_tab identifies it',
    annotations: WRITE,
    run: () => core.newTab(),
  });

  defineTool(server, {
    name: 'tab_close',
    description: 'Close the current chart tab',
    annotations: DESTRUCTIVE,
    run: () => core.closeTab(),
  });

  defineTool(server, {
    name: 'tab_switch',
    description: 'Switch to a chart tab by index',
    inputSchema: {
      index: z.coerce.number().describe('Tab index (0-based, from tab_list)'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ index }) => core.switchTab({ index }),
  });
}
