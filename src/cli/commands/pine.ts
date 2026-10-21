import { register, command } from '../router.js';
import * as core from '../../core/pine.js';
import { readFileSync } from 'fs';

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function readSource(file?: string) {
  const source = file ? readFileSync(file, 'utf-8') : await readStdin();
  if (!source) throw new Error('No source provided. Pipe source via stdin or use --file.');
  return source;
}

register('pine', {
  description: 'Pine Script tools',
  subcommands: new Map([
    ['get', command({
      description: 'Get current Pine Script source from editor',
      handler: () => core.getSource(),
    })],
    ['set', command({
      description: 'Set Pine Script source (reads stdin or --file)',
      options: {
        file: { type: 'string', short: 'f', description: 'Read source from file' },
      },
      handler: async (opts) => {
        const source = await readSource(opts.file);
        return core.setSource({ source });
      },
    })],
    ['compile', command({
      description: 'Smart compile: detect button, compile, confirm, report errors and warnings',
      handler: () => core.smartCompile(),
    })],
    ['raw-compile', command({
      description: 'Click compile/add button without smart detection',
      handler: () => core.compile(),
    })],
    ['analyze', command({
      description: 'Offline static analysis (no TradingView needed)',
      options: {
        file: { type: 'string', short: 'f', description: 'Read source from file' },
      },
      handler: async (opts) => {
        const source = await readSource(opts.file);
        return core.analyze({ source });
      },
    })],
    ['check', command({
      description: 'Server-side compile check (no chart needed)',
      options: {
        file: { type: 'string', short: 'f', description: 'Read source from file' },
      },
      handler: async (opts) => {
        const source = await readSource(opts.file);
        return core.check({ source });
      },
    })],
    ['save', command({
      description: 'Save the current Pine Script (Cmd+S on macOS, Ctrl+S elsewhere)',
      handler: () => core.save(),
    })],
    ['new', command({
      description: 'Replace the editor with a new blank Pine Script (indicator, strategy, library); refuses if a saved script is open',
      options: {
        'replace-current': { type: 'boolean', description: 'Replace the editor even if a saved script is open (a later save would overwrite it)' },
      },
      handler: (opts, positionals) => {
        const type = (positionals[0] || 'indicator') as 'indicator' | 'strategy' | 'library';
        return core.newScript({ type, replace_current: opts['replace-current'] });
      },
    })],
    ['open', command({
      description: 'Load a saved Pine Script by name into the editor; refuses if a saved script is open',
      options: {
        'replace-current': { type: 'boolean', description: 'Replace the editor even if a saved script is open (a later save would overwrite it)' },
      },
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Script name required. Usage: tv pine open "My Script"');
        return core.openScript({ name: positionals.join(' '), replace_current: opts['replace-current'] });
      },
    })],
    ['list', command({
      description: 'List saved Pine Scripts',
      handler: () => core.listScripts(),
    })],
    ['errors', command({
      description: 'Get Pine Script compilation errors',
      handler: () => core.getErrors(),
    })],
    ['console', command({
      description: 'Get Pine Script console/log output',
      handler: () => core.getConsole(),
    })],
  ]),
});
