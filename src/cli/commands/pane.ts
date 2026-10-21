import { register, command, parseNumber } from '../router.js';
import * as core from '../../core/pane.js';

register('pane', {
  description: 'Chart pane/layout tools (list, layout, focus, symbol)',
  subcommands: new Map([
    ['list', command({
      description: 'List all panes in the current layout',
      handler: () => core.list(),
    })],
    ['layout', command({
      description: 'Set chart grid layout (s, 2h, 2v, 2x2, 4, 6, 8)',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Layout required. Usage: tv pane layout 2x2');
        return core.setLayout({ layout: positionals[0] });
      },
    })],
    ['focus', command({
      description: 'Focus a specific pane by index',
      handler: (opts, positionals) => {
        if (positionals[0] === undefined) throw new Error('Index required. Usage: tv pane focus 0');
        return core.focus({ index: parseNumber(positionals[0], 'index') });
      },
    })],
    ['symbol', command({
      description: 'Set symbol on a specific pane',
      handler: (opts, positionals) => {
        if (positionals.length < 2) throw new Error('Usage: tv pane symbol 1 ES1!');
        return core.setSymbol({ index: parseNumber(positionals[0], 'index'), symbol: positionals[1] });
      },
    })],
  ]),
});
