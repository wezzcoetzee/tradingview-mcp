/**
 * CLI flag parsing tests — no TradingView connection needed.
 * Every case fails during argument validation, before any CDP call.
 *
 * Run: bun test tests/cli_flags.test.ts
 */

import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli', 'index.ts');

function run(args: string[]) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf-8', timeout: 15000 });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const failure = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: failure.stdout || '', stderr: failure.stderr || '', exitCode: failure.status };
  }
}

describe('CLI — unknown flags', () => {
  it('rejects an unknown flag and lists valid options', () => {
    const { exitCode, stderr } = run(['ohlcv', '--cnt', '5']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Unknown option '--cnt'"), stderr);
    assert.ok(stderr.includes('--count'), stderr);
    assert.ok(stderr.includes('--summary'), stderr);
  });

  it('rejects an unknown flag on a subcommand', () => {
    const { exitCode, stderr } = run(['indicator', 'toggle', 'abc', '--hidden']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Unknown option '--hidden'"), stderr);
    assert.ok(stderr.includes('--hide'), stderr);
  });
});

describe('CLI — boolean values', () => {
  it('rejects a non-boolean --visible value', () => {
    const { exitCode, stderr } = run(['indicator', 'toggle', 'abc', '--visible', 'maybe']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('--visible must be'), stderr);
  });

  it('requires a value for --visible', () => {
    const { exitCode } = run(['indicator', 'toggle', 'abc', '--visible']);
    assert.equal(exitCode, 1);
  });

  it('documents --hide and --visible in toggle help', () => {
    const { stdout, exitCode } = run(['indicator', 'toggle', '--help']);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('--hide'));
    assert.ok(stdout.includes('--visible'));
  });
});

describe('CLI — required values', () => {
  it('rejects a missing drawing price', () => {
    const { exitCode, stderr } = run(['draw', 'shape', '--time', '1700000000']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('--price must be a number'), stderr);
  });

  it('rejects a non-numeric drawing time', () => {
    const { exitCode, stderr } = run(['draw', 'shape', '--time', 'soon', '--price', '100']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('--time must be a number'), stderr);
  });

  it('requires an entity id for draw get and remove', () => {
    for (const sub of ['get', 'remove']) {
      const { exitCode, stderr } = run(['draw', sub]);
      assert.equal(exitCode, 1, sub);
      assert.ok(stderr.includes('Entity ID required'), stderr);
    }
  });

  it('requires --value for ui click and hover', () => {
    for (const sub of ['click', 'hover']) {
      const { exitCode, stderr } = run(['ui', sub]);
      assert.equal(exitCode, 1, sub);
      assert.ok(stderr.includes('--value required'), stderr);
    }
  });

  it('rejects a partial chart range', () => {
    const { exitCode, stderr } = run(['range', '--from', '1700000000']);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('--to must be a number'), stderr);
  });
});
