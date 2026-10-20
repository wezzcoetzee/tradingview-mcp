import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, zBool, IDEMPOTENT_WRITE } from './_format.js';
import * as core from '../core/indicators.js';

export function registerIndicatorTools(server: McpServer) {
  defineTool(server, {
    name: 'indicator_set_inputs',
    description: 'Change indicator/study input values (e.g., length, source, period)',
    inputSchema: {
      entity_id: z.string().describe('Entity ID of the study (from chart_get_state)'),
      inputs: z.string().describe('JSON string of input overrides, e.g. \'{"length": 50, "source": "close"}\'. Keys are input IDs, values are the new values.'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ entity_id, inputs }) => core.setInputs({ entity_id, inputs }),
  });

  defineTool(server, {
    name: 'indicator_toggle_visibility',
    description: 'Show or hide an indicator/study on the chart',
    inputSchema: {
      entity_id: z.string().describe('Entity ID of the study (from chart_get_state)'),
      visible: zBool.describe('true to show, false to hide'),
    },
    annotations: IDEMPOTENT_WRITE,
    run: ({ entity_id, visible }) => core.toggleVisibility({ entity_id, visible }),
  });
}
