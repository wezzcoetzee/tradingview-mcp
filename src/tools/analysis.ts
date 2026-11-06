import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, READ_ONLY } from './_format.js';
import { ANALYSIS_SECTIONS, getStudySeries, getAnalysisSnapshot } from '../core/analysis.js';

export function registerAnalysisTools(server: McpServer) {
  defineTool(server, {
    name: 'data_get_study_series',
    description: 'Read loaded historical numeric line plots by study entity ID, aligned to underlying bar timestamps. Missing/warmup/unsupported values are null. Does not use crosshair data-window values or load history.',
    inputSchema: {
      entity_id: z.string().min(1).describe('Study ID from chart_get_state'),
      plots: z.array(z.string().min(1)).min(1).optional().describe('Plot IDs or exact names; omit for all supported numeric line plots'),
      count: z.coerce.number().optional().describe('Latest matching bars, default 100, capped at 500'),
      from: z.coerce.number().optional().describe('Inclusive Unix seconds, loaded bars only'),
      to: z.coerce.number().optional().describe('Inclusive Unix seconds'),
    },
    annotations: READ_ONLY,
    run: params => getStudySeries(params),
  });
  defineTool(server, {
    name: 'chart_get_analysis_snapshot',
    description: 'Compact price, latest model study plots and Pine graphics in one synchronous evaluation, guarded against chart/latest-bar changes. Reports capture interval, unknown feed/candle status, warnings and partial sections. No screenshot.',
    inputSchema: {
      count: z.coerce.number().optional().describe('Price summary bar count, default 100, max 500'),
      sections: z.array(z.enum(ANALYSIS_SECTIONS)).min(1).optional().describe('Requested sections; default all'),
      study_filter: z.string().optional().describe('Case-insensitive study name substring for studies and graphics'),
    },
    annotations: READ_ONLY,
    run: params => getAnalysisSnapshot(params),
  });
}
