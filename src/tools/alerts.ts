import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, zBool, DESTRUCTIVE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/alerts.js';

const alertId = z.union([z.number(), z.string()]);

export function registerAlertTools(server: McpServer) {
  defineTool(server, {
    name: 'alert_create',
    description: 'Configure an exact price alert on the active chart. Defaults: crossing, only once, chart resolution, expiry in 30 days. Refuses unsupported dialog controls; submitted alerts remain unverified until list condition/frequency can be decoded. Never automatically retry submitted:true.',
    inputSchema: {
      price: z.coerce.number().describe('Price level for the alert'),
      message: z.string().optional().describe('Alert message (default empty)'),
      condition: z.enum(core.conditions).optional(),
      frequency: z.enum(core.frequencies).optional(),
      resolution: z.string().optional().describe('Must match active chart resolution'),
      expiry: z.number().int().optional().describe('Future unix seconds; defaults to 30 days'),
      expected_symbol: z.string().optional().describe('Refuse if active chart symbol differs'),
    },
    annotations: WRITE,
    run: options => core.create(options),
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
