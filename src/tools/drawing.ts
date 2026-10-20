import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, zBool, DESTRUCTIVE, READ_ONLY, WRITE } from './_format.js';
import * as core from '../core/drawing.js';

const chartPoint = z.object({
  time: z.coerce.number().describe('Unix time in seconds, not milliseconds'),
  price: z.coerce.number(),
});

export function registerDrawingTools(server: McpServer) {
  defineTool(server, {
    name: 'draw_shape',
    description: 'Draw a shape/line on the chart. Points are used in the order point, point2, more_points: 1 point for horizontal/vertical lines and text, 2 for trend lines, rectangles and long/short position tools, 3 or more for channels, pitchforks and fib extensions.',
    inputSchema: {
      shape: z.string().describe('Shape type: horizontal_line, vertical_line, trend_line, rectangle, text'),
      point: chartPoint.describe('{ time: unix seconds, price: number }'),
      point2: chartPoint.optional().describe('Second point for two-point shapes (trend_line, rectangle, long_position)'),
      more_points: z.array(chartPoint).optional().describe('Third and later points for multi-point shapes (channels, pitchforks, fib extensions). Requires point2.'),
      lock: zBool.optional().describe('Lock the shape after creating it so it cannot be moved or edited by hand; verified by reading it back'),
      overrides: z.string().optional().describe('JSON string of style overrides (e.g., \'{"linecolor": "#ff0000", "linewidth": 2}\')'),
      text: z.string().optional().describe('Text content for text shapes'),
    },
    annotations: WRITE,
    run: (args) => core.drawShape(args),
  });

  defineTool(server, {
    name: 'draw_list',
    description: 'List all shapes/drawings on the chart with their id, name and points',
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
      verbose: zBool.optional().describe('Also list the methods the drawing object exposes (default false)'),
    },
    annotations: READ_ONLY,
    run: ({ entity_id, verbose }) => core.getProperties({ entity_id, verbose }),
  });
}
