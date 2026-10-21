import { register, command } from '../router.js';
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
      },
      handler: (opts) => core.create({
        price: Number(opts.price),
        message: opts.message,
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
