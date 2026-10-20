import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, zBool, DESTRUCTIVE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/alerts.js';

const alertId = z.union([z.number(), z.string()]);

export function registerAlertTools(server: McpServer) {
  defineTool(server, {
    name: 'alert_create',
    description: 'Create a price alert via the TradingView alert dialog. Note: condition must be set manually in the dialog before clicking Create.',
    inputSchema: {
      price: z.coerce.number().describe('Price level for the alert'),
      message: z.string().optional().describe('Alert message'),
    },
    annotations: WRITE,
    run: ({ price, message }) => core.create({ price, message }),
  });

  defineTool(server, {
    name: 'alert_list',
    description: 'List active alerts',
    annotations: READ_ONLY,
    run: () => core.list(),
  });

  defineTool(server, {
    name: 'alert_delete',
    description: 'Delete alerts by id (from alert_list) or all alerts, then verify via alert_list',
    inputSchema: {
      alert_id: z.union([alertId, z.array(alertId)]).optional().describe('Alert id or ids from alert_list'),
      delete_all: zBool.optional().describe('Delete every alert (must be explicit)'),
    },
    annotations: DESTRUCTIVE,
    run: ({ alert_id, delete_all }) => core.deleteAlerts({ alert_id, delete_all }),
  });
}
