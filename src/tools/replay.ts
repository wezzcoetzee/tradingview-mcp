import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/replay.js';

export function registerReplayTools(server: McpServer) {
  defineTool(server, {
    name: 'replay_start',
    description: 'Start bar replay mode, optionally at a specific date',
    inputSchema: {
      date: z.string().optional().describe('Date to start replay from (YYYY-MM-DD format). If omitted, selects first available date.'),
    },
    annotations: WRITE,
    run: ({ date }) => core.start({ date }),
  });

  defineTool(server, {
    name: 'replay_step',
    description: 'Advance one bar in replay mode',
    annotations: WRITE,
    run: () => core.step(),
  });

  defineTool(server, {
    name: 'replay_autoplay',
    description: 'Toggle autoplay in replay mode, optionally set speed',
    inputSchema: {
      speed: z.coerce.number().optional().describe('Autoplay delay in ms (lower = faster). Valid values: 100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000. Leave empty to just toggle.'),
    },
    annotations: WRITE,
    run: ({ speed }) => core.autoplay({ speed }),
  });

  defineTool(server, {
    name: 'replay_stop',
    description: 'Stop replay and return to realtime',
    annotations: IDEMPOTENT_WRITE,
    run: () => core.stop(),
  });

  defineTool(server, {
    name: 'replay_trade',
    description: 'Execute a trade action in replay mode (buy, sell, or close position)',
    inputSchema: {
      action: z.string().describe('Trade action: buy, sell, or close'),
    },
    annotations: DESTRUCTIVE,
    run: ({ action }) => core.trade({ action }),
  });

  defineTool(server, {
    name: 'replay_status',
    description: 'Get current replay mode status',
    annotations: READ_ONLY,
    run: () => core.status(),
  });
}
