import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, DESTRUCTIVE, READ_ONLY } from './_format.js';
import * as core from '../core/health.js';

export function registerHealthTools(server: McpServer) {
  defineTool(server, {
    name: 'tv_health_check',
    description: 'Check CDP connection to TradingView and return current chart state',
    annotations: READ_ONLY,
    run: () => core.healthCheck(),
    onError: (error) => ({ success: false, error, hint: 'TradingView is not running with CDP enabled. Use the tv_launch tool to start it automatically.' }),
  });

  defineTool(server, {
    name: 'tv_discover',
    description: 'Report which known TradingView API paths are available and their methods',
    annotations: READ_ONLY,
    run: () => core.discover(),
  });

  defineTool(server, {
    name: 'tv_ui_state',
    description: 'Get current UI state: which panels are open, what buttons are visible/enabled/disabled',
    annotations: READ_ONLY,
    run: () => core.uiState(),
  });

  defineTool(server, {
    name: 'tv_launch',
    description: 'Launch TradingView Desktop with Chrome DevTools Protocol (remote debugging) enabled. Auto-detects install location on Mac, Windows, and Linux.',
    inputSchema: {
      port: z.coerce.number().optional().describe('CDP port (default 9222)'),
      kill_existing: z.coerce.boolean().optional().describe('Kill existing TradingView instances first (default true)'),
    },
    annotations: DESTRUCTIVE,
    run: ({ port, kill_existing }) => core.launch({ port, kill_existing }),
  });
}
