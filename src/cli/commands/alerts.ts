import { register, command, parseChoice, parseNumber } from '../router.js';
import * as core from '../../core/alerts.js';

register('alert', {
  description: 'Alert tools (list, create, delete)',
  subcommands: new Map([
    ['list', command({
      description: 'List active alerts',
      handler: () => core.list(),
    })],
    ['create', command({
      description: 'Create a price alert',
      options: {
        price: { type: 'string', short: 'p', description: 'Price level' },
        message: { type: 'string', short: 'm', description: 'Alert message' },
        condition: { type: 'string', description: core.conditions.join(', ') },
        frequency: { type: 'string', description: core.frequencies.join(', ') },
        resolution: { type: 'string', description: 'Expected chart resolution' },
        expiry: { type: 'string', description: 'Expiry unix seconds (default 30 days)' },
        symbol: { type: 'string', description: 'Expected active chart symbol' },
      },
      handler: (opts) => core.create({
        price: parseNumber(opts.price, 'price'),
        message: opts.message,
        condition: opts.condition === undefined ? undefined : parseChoice(opts.condition, core.conditions, 'condition'),
        frequency: opts.frequency === undefined ? undefined : parseChoice(opts.frequency, core.frequencies, 'frequency'),
        resolution: opts.resolution,
        expiry: opts.expiry === undefined ? undefined : parseNumber(opts.expiry, 'expiry'),
        expected_symbol: opts.symbol,
      }),
    })],
    ['delete', command({
      description: 'Delete alerts',
      options: {
        id: { type: 'string', short: 'i', description: 'Alert id(s) from `alert list`, comma-separated' },
        all: { type: 'boolean', description: 'Delete all alerts' },
      },
      handler: (opts) => core.deleteAlerts({ alert_id: opts.id?.split(','), delete_all: opts.all }),
    })],
  ]),
});
