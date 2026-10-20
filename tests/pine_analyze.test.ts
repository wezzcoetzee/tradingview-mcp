/**
 * Unit tests for pine_analyze static analysis and pine_check response handling.
 * No TradingView connection needed.
 */

import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { analyze as analyzeSource, check } from '../src/core/pine.js';

const analyze = (source: string) => analyzeSource({ source }).diagnostics;

describe('pine_analyze — static analysis', () => {
  it('clean v6 script — no issues', () => {
    const diags = analyze(`//@version=6
indicator("Test", overlay=true)
a = array.from(1, 2, 3)
val = array.get(a, 1)
plot(close)`);
    assert.equal(diags.length, 0);
  });

  it('array.get out of bounds', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.from(1, 2, 3)
val = array.get(a, 5)`);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, 'error');
    assert.ok(diags[0].message.includes('out of bounds'));
    assert.ok(diags[0].message.includes('index 5'));
    assert.ok(diags[0].message.includes('size is 3'));
  });

  it('array.get negative index', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.from(1, 2)
val = array.get(a, -1)`);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, 'error');
  });

  it('array.set out of bounds', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.new_float(3)
array.set(a, 10, 99.0)`);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, 'error');
    assert.ok(diags[0].message.includes('array.set'));
  });

  it('array.get valid index — no issue', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.from(10, 20, 30, 40, 50)
val = array.get(a, 4)`);
    assert.equal(diags.length, 0);
  });

  it('.first() on empty array', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.new_float(0)
x = a.first()`);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, 'warning');
    assert.ok(diags[0].message.includes('empty array'));
  });

  it('.last() on empty array', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.new_float(0)
x = a.last()`);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, 'warning');
  });

  it('.first() on non-empty array — no issue', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.from(1, 2, 3)
x = a.first()`);
    assert.equal(diags.length, 0);
  });

  it('strategy.entry without strategy() declaration', () => {
    const diags = analyze(`//@version=6
indicator("Test")
strategy.entry("Long", strategy.long)`);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, 'error');
    assert.ok(diags[0].message.includes('no strategy() declaration'));
  });

  it('strategy.entry WITH strategy() — no issue', () => {
    const diags = analyze(`//@version=6
strategy("Test", overlay=true)
if close > open
    strategy.entry("Long", strategy.long)`);
    assert.equal(diags.length, 0);
  });

  it('old version v3 warning', () => {
    const diags = analyze(`//@version=3
study("Test")
plot(close)`);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, 'info');
    assert.ok(diags[0].message.includes('v3'));
    assert.ok(diags[0].message.includes('upgrading'));
  });

  it('v5 — no version warning', () => {
    const diags = analyze(`//@version=5
indicator("Test")
plot(close)`);
    assert.equal(diags.length, 0);
  });

  it('multiple issues at once', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.from(1, 2)
b = array.new_float(0)
x = array.get(a, 5)
y = b.first()
strategy.entry("Long", strategy.long)`);
    assert.ok(diags.length >= 3, `Expected >= 3 issues, got ${diags.length}`);
    const errors = diags.filter(d => d.severity === 'error');
    const warnings = diags.filter(d => d.severity === 'warning');
    assert.ok(errors.length >= 2, 'Should have OOB error + strategy error');
    assert.ok(warnings.length >= 1, 'Should have empty array warning');
  });
  it('push after array.new_*(0) clears the known size', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.new_float(0)
array.push(a, close)
x = array.get(a, 0)
y = a.first()`);
    assert.equal(diags.length, 0);
  });

  it('method-style mutators clear the known size', () => {
    for (const call of ['a.push(1)', 'a.unshift(1)', 'a.insert(0, 1)', 'a.pop()', 'a.shift()', 'a.remove(0)', 'a.clear()']) {
      const diags = analyze(`//@version=6
indicator("Test")
a = array.from(1, 2)
${call}
x = array.get(a, 5)`);
      assert.equal(diags.length, 0, call);
    }
  });

  it('mutating one array does not hide errors on another', () => {
    const diags = analyze(`//@version=6
indicator("Test")
a = array.from(1)
b = array.from(1)
array.push(a, 2)
x = array.get(b, 3)`);
    assert.equal(diags.length, 1);
  });
});

describe('pine_check — server response handling', () => {
  const respond = (body: string, init: { status?: number; statusText?: string; type?: string } = {}) =>
    (async () => new Response(body, {
      status: init.status ?? 200,
      statusText: init.statusText,
      headers: { 'content-type': init.type ?? 'application/json' },
    })) as unknown as typeof fetch;

  it('reports compiled for a valid result', async () => {
    const r = await check({ source: 'x', fetchFn: respond(JSON.stringify({ success: true, result: {} })) });
    assert.equal(r.compiled, true);
  });

  it('reports errors2 as compile errors', async () => {
    const body = { result: { errors2: [{ start: { line: 3, column: 1 }, message: 'bad' }] } };
    const r = await check({ source: 'x', fetchFn: respond(JSON.stringify(body)) });
    assert.equal(r.compiled, false);
    assert.equal(r.error_count, 1);
  });

  it('fails on an HTML response instead of reporting compiled', async () => {
    await assert.rejects(check({ source: 'x', fetchFn: respond('<html>blocked</html>', { type: 'text/html' }) }), /unexpected/i);
  });

  it('fails on JSON without a result or error', async () => {
    await assert.rejects(check({ source: 'x', fetchFn: respond('{"foo":1}') }), /unexpected/i);
  });

  it('fails on a rate limit status', async () => {
    await assert.rejects(check({ source: 'x', fetchFn: respond('slow down', { status: 429, statusText: 'Too Many Requests' }) }), /429/);
  });
});
