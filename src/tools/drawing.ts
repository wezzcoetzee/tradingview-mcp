import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, DESTRUCTIVE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/drawing.js';

export function registerDrawingTools(server: McpServer) {
  defineTool(server, {
    name: 'draw_shape',
    description: 'Draw a shape/line on the chart',
    inputSchema: {
      shape: z.string().describe('Shape type: horizontal_line, vertical_line, trend_line, rectangle, text'),
      point: z.object({ time: z.coerce.number(), price: z.coerce.number() }).describe('{ time: unix_timestamp, price: number }'),
      point2: z.object({ time: z.coerce.number(), price: z.coerce.number() }).optional().describe('Second point for two-point shapes (trend_line, rectangle)'),
      overrides: z.string().optional().describe('JSON string of style overrides (e.g., \'{"linecolor": "#ff0000", "linewidth": 2}\')'),
      text: z.string().optional().describe('Text content for text shapes'),
    },
    annotations: WRITE,
    run: ({ shape, point, point2, overrides, text }) => core.drawShape({ shape, point, point2, overrides, text }),
  });

  defineTool(server, {
    name: 'draw_list',
    description: 'List all shapes/drawings on the chart',
    annotations: READ_ONLY,
    run: () => core.listDrawings(),
  });

  defineTool(server, {
    name: 'draw_clear',
    description: 'Remove all drawings from the chart',
    annotations: DESTRUCTIVE,
    run: () => core.clearAll(),
  });

  defineTool(server, {
    name: 'draw_remove_one',
    description: 'Remove a specific drawing by entity ID',
    inputSchema: {
      entity_id: z.string().describe('Entity ID of the drawing to remove (from draw_list)'),
    },
    annotations: DESTRUCTIVE,
    run: ({ entity_id }) => core.removeOne({ entity_id }),
  });

  defineTool(server, {
    name: 'draw_get_properties',
    description: 'Get properties and points of a specific drawing',
    inputSchema: {
      entity_id: z.string().describe('Entity ID of the drawing (from draw_list)'),
    },
    annotations: READ_ONLY,
    run: ({ entity_id }) => core.getProperties({ entity_id }),
  });
}
