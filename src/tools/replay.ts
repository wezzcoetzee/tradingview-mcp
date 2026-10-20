import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, zBool, DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/replay.js';

export function registerReplayTools(server: McpServer) {
  defineTool(server, {
    name: 'replay_start',
    description: 'Start bar replay mode, optionally at a specific date. The date is validated before the replay toolbar is touched.',
    inputSchema: {
      date: z.string().optional().describe('Date to start replay from (YYYY-MM-DD format, UTC). If omitted, selects first available date.'),
    },
    annotations: WRITE,
    run: ({ date }) => core.start({ date }),
  });

  defineTool(server, {
    name: 'replay_step',
    description: 'Advance one or more bars in replay mode. Returns advanced, the number of bars actually stepped; stops and reports success false at the first step that does not move.',
    inputSchema: {
      count: z.coerce.number().int().min(1).max(core.MAX_STEP_COUNT).optional().describe(`Number of bars to advance (1 to ${core.MAX_STEP_COUNT}, default 1)`),
    },
    annotations: WRITE,
    run: ({ count }) => core.step({ count }),
  });

  defineTool(server, {
    name: 'replay_jump',
    description: 'Jump to another date while replay is running, without restarting it',
    inputSchema: {
      date: z.string().describe('Date to jump to (YYYY-MM-DD, UTC)'),
    },
    annotations: WRITE,
    run: ({ date }) => core.jump({ date }),
  });

  defineTool(server, {
    name: 'replay_autoplay',
    description: 'Turn autoplay on or off in replay mode, optionally set speed. Without enabled it flips the current state. autoplay_active reports the verified state.',
    inputSchema: {
      speed: z.coerce.number().optional().describe('Autoplay delay in ms (lower = faster). Valid values: 100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000. Leave empty to keep the current speed.'),
      enabled: zBool.optional().describe('true to start autoplay, false to stop it. Omit to flip the current state.'),
    },
    annotations: WRITE,
    run: ({ speed, enabled }) => core.autoplay({ speed, enabled }),
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
