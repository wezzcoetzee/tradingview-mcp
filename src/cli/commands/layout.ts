import { register, command } from '../router.js';
import * as core from '../../core/ui.js';

register('layout', {
  description: 'Layout tools (list, switch)',
  subcommands: new Map([
    ['list', command({
      description: 'List saved chart layouts',
      handler: () => core.layoutList(),
    })],
    ['switch', command({
      description: 'Switch to a saved layout by name or ID',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Layout name required. Usage: tv layout switch "My Layout"');
        return core.layoutSwitch({ name: positionals.join(' ') });
      },
    })],
  ]),
});
