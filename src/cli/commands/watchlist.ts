import { register, command } from '../router.js';
import * as core from '../../core/watchlist.js';

register('watchlist', {
  description: 'Watchlist tools (get, add)',
  subcommands: new Map([
    ['get', command({
      description: 'Get watchlist symbols',
      handler: () => core.get(),
    })],
    ['add', command({
      description: 'Add a symbol to the watchlist',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Symbol required. Usage: tv watchlist add AAPL');
        return core.add({ symbol: positionals[0] });
      },
    })],
  ]),
});
