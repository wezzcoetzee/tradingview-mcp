/**
 * CLI command router using node:util parseArgs.
 * Zero dependencies — uses only Node.js built-ins.
 * Flags are parsed in strict mode: unknown flags fail with the list of valid ones.
 */
import { parseArgs } from 'node:util';

type OptionSpec = { type: 'string' | 'boolean'; short?: string; description?: string };
type OptionMap = Record<string, OptionSpec>;

/** @type {Map<string, { description: string, options?: object, handler: Function, subcommands?: Map<string, object> }>} */
const commands = new Map();

export function register(name, config) {
  commands.set(name, config);
}

/** Parses a `true`/`false` value for a flag that takes a value, e.g. `--visible false`. */
export function parseBoolean(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`--${flag} must be "true" or "false", got "${value}"`);
}

/** Rejects missing or non-numeric values instead of passing NaN into core. */
export function parseNumber(value: string | undefined, flag: string): number {
  if (value === undefined || value.trim() === '' || !Number.isFinite(Number(value))) {
    throw new Error(`--${flag} must be a number`);
  }
  return Number(value);
}

function flagLabel(name: string, spec: OptionSpec): string {
  return spec.short ? `-${spec.short}, --${name}` : `    --${name}`;
}

function printOptions(options: OptionMap) {
  if (Object.keys(options).length === 0) return;
  console.log('\nOptions:');
  for (const [name, spec] of Object.entries(options)) {
    console.log(`  ${flagLabel(name, spec).padEnd(20)}${spec.description || ''}`);
  }
}

function printHelp() {
  console.log('Usage: tv <command> [options]\n');
  console.log('Commands:');
  const maxLen = Math.max(...[...commands.keys()].map(k => k.length));
  for (const [name, cmd] of commands) {
    if (cmd.subcommands) {
      const subs = [...cmd.subcommands.keys()].join(', ');
      console.log(`  ${name.padEnd(maxLen + 2)}${cmd.description}  [${subs}]`);
    } else {
      console.log(`  ${name.padEnd(maxLen + 2)}${cmd.description}`);
    }
  }
  console.log('\nRun "tv <command> --help" for command-specific options.');
  console.log('\nDISCLAIMER');
  console.log('  Not affiliated with TradingView Inc. or Anthropic, PBC.');
  console.log('  Use subject to TradingView\'s Terms of Use: tradingview.com/policies');
}

function printCommandHelp(name: string, cmd) {
  if (cmd.subcommands) {
    console.log(`Usage: tv ${name} <subcommand> [options]\n`);
    console.log('Subcommands:');
    for (const [sub, subConf] of cmd.subcommands) {
      console.log(`  ${sub.padEnd(12)}${subConf.description}`);
    }
    return;
  }
  console.log(`Usage: tv ${name} [options]\n`);
  console.log(cmd.description);
  printOptions(cmd.options || {});
}

const UNKNOWN_OPTION = /Unknown option '([^']+)'/;

function parseCommandArgs(args: string[], options: OptionMap) {
  const spec: OptionMap = { help: { type: 'boolean', short: 'h' }, ...options };
  try {
    return parseArgs({ args, options: spec, allowPositionals: true, strict: true });
  } catch (err) {
    const unknown = err instanceof Error ? UNKNOWN_OPTION.exec(err.message)?.[1] : undefined;
    if (unknown) {
      const valid = Object.entries(spec).map(([name, s]) => flagLabel(name, s).trim()).join(', ');
      throw new Error(`Unknown option '${unknown}'. Valid options: ${valid}`);
    }
    throw err;
  }
}

export async function run(argv) {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const cmdName = args[0];
  const cmd = commands.get(cmdName);

  if (!cmd) {
    console.error(`Unknown command: ${cmdName}`);
    console.error('Run "tv --help" for a list of commands.');
    process.exit(1);
  }

  let name = cmdName;
  let target = cmd;
  let rest = args.slice(1);

  // Handle subcommands (e.g., tv pine get)
  if (cmd.subcommands) {
    const subName = args[1];
    if (!subName || subName === '--help' || subName === '-h') {
      printCommandHelp(cmdName, cmd);
      process.exit(0);
    }
    const sub = cmd.subcommands.get(subName);
    if (!sub) {
      console.error(`Unknown subcommand: ${cmdName} ${subName}`);
      printCommandHelp(cmdName, cmd);
      process.exit(1);
    }
    name = `${cmdName} ${subName}`;
    target = sub;
    rest = args.slice(2);
  }

  try {
    const { values, positionals } = parseCommandArgs(rest, target.options || {});
    if (values.help) {
      printCommandHelp(name, target);
      process.exit(0);
    }
    await execute(target.handler, values, positionals);
  } catch (err) {
    handleError(err);
  }
}

async function execute(handler, values, positionals) {
  try {
    const result = await handler(values, positionals);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    handleError(err);
  }
}

function handleError(err) {
  const message = err.message || String(err);
  // Connection failures get exit code 2
  if (/CDP|connection|ECONNREFUSED|not running/i.test(message)) {
    console.error(JSON.stringify({ success: false, error: message }, null, 2));
    process.exit(2);
  }
  console.error(JSON.stringify({ success: false, error: message }, null, 2));
  process.exit(1);
}
