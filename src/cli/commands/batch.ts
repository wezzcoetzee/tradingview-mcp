import { register, parseChoice } from '../router.js';
import { batchRun, BATCH_ACTIONS } from '../../core/batch.js';

register('batch', {
  description: 'Run bounded collections across symbols/timeframes and restore chart state',
  options: {
    symbols: { type: 'string', description: 'Comma-separated symbols (required)' },
    timeframes: { type: 'string', description: 'Comma-separated timeframes' },
    action: { type: 'string', description: BATCH_ACTIONS.join(', ') },
    filter: { type: 'string', description: 'Study name substring' },
    'max-items': { type: 'string', description: 'Collection cap (default 20, max 50)' },
    count: { type: 'string', description: 'OHLCV count (default 100, max 500)' },
    'delay-ms': { type: 'string', description: 'Delay after readiness (default 2000)' },
  },
  handler: opts => batchRun({
    symbols: opts.symbols?.split(',') ?? [], timeframes: opts.timeframes?.split(','),
    action: parseChoice(opts.action ?? 'get_ohlcv', BATCH_ACTIONS, 'action'),
    study_filter: opts.filter, max_items: opts['max-items'] === undefined ? undefined : Number(opts['max-items']),
    ohlcv_count: opts.count === undefined ? undefined : Number(opts.count),
    delay_ms: opts['delay-ms'] === undefined ? undefined : Number(opts['delay-ms']),
  }),
});
