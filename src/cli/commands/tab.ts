import { register, command } from '../router.js';
import * as core from '../../core/tab.js';

register('tab', {
  description: 'Tab management (list, new, close, switch)',
  subcommands: new Map([
    ['list', command({
      description: 'List all open chart tabs',
      handler: () => core.list(),
    })],
    ['new', command({
      description: 'Open a new chart tab',
      handler: () => core.newTab(),
    })],
    ['close', command({
      description: 'Close the current tab',
      handler: () => core.closeTab(),
    })],
    ['switch', command({
      description: 'Switch to a tab by index',
      handler: (opts, positionals) => {
        if (positionals[0] === undefined) throw new Error('Index required. Usage: tv tab switch 0');
        return core.switchTab({ index: positionals[0] });
      },
    })],
  ]),
});
