import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as connection from '../src/connection.js';

describe('connection — concurrency & error handling', () => {
  it('safeString throws on null/undefined to surface caller bugs', () => {
    assert.throws(() => connection.safeString(null), /must not be null or undefined/);
    assert.throws(() => connection.safeString(undefined), /must not be null or undefined/);
  });

  it('requireFinite rejects NaN, Infinity, and non-numeric strings', () => {
    assert.throws(() => connection.requireFinite(NaN, 'x'), /finite number/);
    assert.throws(() => connection.requireFinite(Infinity, 'x'), /finite number/);
    assert.throws(() => connection.requireFinite('not-a-num', 'x'), /finite number/);
    assert.equal(connection.requireFinite(42, 'x'), 42);
    assert.equal(connection.requireFinite('42', 'x'), 42);
  });
});

describe('debug helper', () => {
  it('respects DEBUG env var matcher', async () => {
    const original = process.env.DEBUG;
    try {
      delete process.env.DEBUG;
      const mod = await import(`../src/debug.js?nocache=${Date.now()}`);
      assert.equal(mod.debugEnabled, false);
    } finally {
      if (original !== undefined) process.env.DEBUG = original;
      else delete process.env.DEBUG;
    }
  });

  it('writes to stderr when enabled', async () => {
    const original = process.env.DEBUG;
    process.env.DEBUG = 'tv-mcp,other';
    try {
      const mod = await import(`../src/debug.js?nocache=${Date.now()}`);
      assert.equal(mod.debugEnabled, true);

      const writes = [];
      const origWrite = process.stderr.write;
      process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
      try {
        mod.debug('test', 'hello', 'world');
      } finally {
        process.stderr.write = origWrite;
      }
      assert.match(writes.join(''), /\[tv-mcp:test\] hello world/);
    } finally {
      if (original !== undefined) process.env.DEBUG = original;
      else delete process.env.DEBUG;
    }
  });
});
