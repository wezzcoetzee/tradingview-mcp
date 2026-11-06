import { register, command } from '../router.js';
import { getOhlcvPage, loadHistory } from '../../core/history.js';

const rangeOptions = {
  from: { type: 'string', description: 'Unix seconds, inclusive' },
  to: { type: 'string', description: 'Unix seconds, inclusive' },
  count: { type: 'string', description: 'Bar count' },
} as const;
const number = (value: string | undefined) => value === undefined ? undefined : Number(value);

register('history', {
  description: 'Bounded history loading and loaded OHLCV pagination',
  subcommands: new Map([
    ['load', command({
      description: 'Attempt loading, report coverage and restore visible range',
      options: { ...rangeOptions,
        'max-attempts': { type: 'string', description: 'Default 5, max 50' },
        'timeout-ms': { type: 'string', description: 'Default 10000, max 60000' },
        'poll-ms': { type: 'string', description: 'Default 250, max 2000' },
      },
      handler: opts => loadHistory({ from: number(opts.from), to: number(opts.to), count: number(opts.count),
        max_attempts: number(opts['max-attempts']), timeout_ms: number(opts['timeout-ms']), poll_ms: number(opts['poll-ms']) }),
    })],
    ['page', command({
      description: 'Read up to 500 loaded bars; use next_before for the previous page',
      options: { ...rangeOptions, before: { type: 'string', description: 'Exclusive upper timestamp cursor' } },
      handler: opts => getOhlcvPage({ from: number(opts.from), to: number(opts.to), count: number(opts.count), before: number(opts.before) }),
    })],
  ]),
});
