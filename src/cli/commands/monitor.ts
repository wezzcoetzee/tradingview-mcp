import { createInterface } from 'node:readline';
import { z } from 'zod';
import { register, command } from '../router.js';
import { WatchManager, directions } from '../../core/monitor.js';
import { disconnect } from '../../connection.js';

const request = z.discriminatedUnion('op', [
  z.object({ op: z.literal('watch_start'), kind: z.enum(['price_crossing', 'bar_close']), price: z.number().optional(),
    direction: z.enum(directions).optional(), ttl_ms: z.number().optional(), capacity: z.number().optional() }).strict(),
  z.object({ op: z.literal('watch_events'), watch_id: z.string(), cursor: z.number().optional() }).strict(),
  z.object({ op: z.literal('watch_stop'), watch_id: z.string() }).strict(),
]);

register('watch', {
  description: 'Process-local watches; use session for start/events/stop in one process',
  subcommands: new Map([
    ['session', command({
      description: 'Read JSONL watch_start/watch_events/watch_stop requests on stdin; emit one JSON result each. EOF or signal clears watches. No background sampling.',
      handler: async () => {
        const manager = new WatchManager();
        const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
        const abort = () => { manager.close(); input.close(); };
        process.once('SIGINT', abort);
        process.once('SIGTERM', abort);
        try {
          for await (const line of input) {
            try {
              const parsed = request.parse(JSON.parse(line));
              const result = parsed.op === 'watch_start' ? await manager.start(parsed)
                : parsed.op === 'watch_events' ? await manager.events(parsed.watch_id, parsed.cursor)
                : await manager.stop(parsed.watch_id);
              process.stdout.write(JSON.stringify(result) + '\n');
            } catch (error) {
              process.stdout.write(JSON.stringify({ success: false, error: String(error) }) + '\n');
            }
          }
        } finally {
          manager.close();
          input.close();
          process.off('SIGINT', abort);
          process.off('SIGTERM', abort);
          await disconnect();
        }
        process.exit(0);
      },
    })],
  ]),
});
