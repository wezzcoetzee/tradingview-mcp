import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool, WRITE } from './_format.js';
import { WatchManager, directions } from '../core/monitor.js';

export const watchOptions = {
  kind: z.enum(['price_crossing', 'bar_close']),
  price: z.number().finite().optional(),
  direction: z.enum(directions).optional(),
  ttl_ms: z.number().int().min(1).max(3_600_000).optional(),
  capacity: z.number().int().min(1).max(256).optional(),
};

export function registerMonitorTools(server: McpServer, manager = new WatchManager()) {
  const onclose = server.server.onclose;
  server.server.onclose = () => { manager.close(); onclose?.(); };
  defineTool(server, {
    name: 'watch_start', annotations: WRITE,
    description: 'Start a process-local watch bound to the active chart. On-call sampling only, no background notifications. Client must schedule watch_events; crossings between samples can be missed.',
    inputSchema: watchOptions,
    run: (options, { signal }) => manager.start(options, signal),
  });
  defineTool(server, {
    name: 'watch_events', annotations: WRITE,
    description: 'Sample this watch once and read retained events after cursor (initially 0). Return cursor for next read. dropped counts overwritten events. Identity changes stop sampling. Unknown ids include expired/stopped watches. Does not wake or resume clients.',
    inputSchema: { watch_id: z.string(), cursor: z.number().int().min(0).optional() },
    run: ({ watch_id, cursor }, { signal }) => manager.events(watch_id, cursor, signal),
  });
  defineTool(server, {
    name: 'watch_stop', annotations: WRITE,
    description: 'Remove a process-local watch and its events. Idempotent.',
    inputSchema: { watch_id: z.string() },
    run: ({ watch_id }) => manager.stop(watch_id),
  });
}
