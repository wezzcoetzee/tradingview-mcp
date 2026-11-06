import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { WatchManager, SAMPLE_JS, type Sample, type Direction } from '../src/core/monitor.js';

const bar = (close: number, time = 100, extra: Partial<Sample> = {}): Sample => ({ identity: 'page:1', symbol: 'EX:A', resolution: '1', time, close, ...extra });
async function fixture(options: Parameters<WatchManager['start']>[0] = { kind: 'price_crossing', price: 10 }) {
  let current = bar(9);
  let now = 0;
  let fail = false;
  let calls = 0;
  const manager = new WatchManager(async () => { calls++; if (fail) throw Error('offline'); return current; }, () => now, 2);
  const start = await manager.start(options);
  assert.ok(start.watch_id);
  return { manager, id: start.watch_id, set: (value: Sample) => { current = value; }, time: (value: number) => { now = value; },
    fail: (value: boolean) => { fail = value; }, calls: () => calls };
}

describe('cooperative watches', () => {
  it('detects real crossings in both directions without repeating above the threshold', async () => {
    const f = await fixture();
    f.set(bar(11));
    const up = await f.manager.events(f.id);
    assert.equal(up.events?.[0].direction, 'crossing_up');
    f.set(bar(12));
    assert.equal((await f.manager.events(f.id, up.cursor)).events?.length, 0);
    f.set(bar(9));
    assert.equal((await f.manager.events(f.id, up.cursor)).events?.[0].direction, 'crossing_down');
  });
  for (const direction of ['crossing_up', 'crossing_down'] as Direction[]) {
    it(`filters ${direction} and handles equality as a boundary`, async () => {
      const f = await fixture({ kind: 'price_crossing', price: 10, direction });
      f.set(bar(10));
      assert.equal((await f.manager.events(f.id)).events?.length, 0);
      f.set(bar(11)); await f.manager.events(f.id);
      f.set(bar(10)); await f.manager.events(f.id);
      f.set(bar(9));
      const result = await f.manager.events(f.id);
      assert.deepEqual(result.events?.map(event => event.direction), [direction]);
    });
  }
  it('confirms bar close only from a subsequent bar, using the final previous close', async () => {
    const f = await fixture({ kind: 'bar_close' });
    f.set(bar(11));
    assert.equal((await f.manager.events(f.id)).events?.length, 0);
    f.set(bar(13, 160, { previous: { time: 100, close: 12 } }));
    const closed = await f.manager.events(f.id);
    assert.deepEqual(closed.events?.map(event => [event.type, event.time, event.price]), [['bar_close', 100, 12]]);
    assert.equal((await f.manager.events(f.id, closed.cursor)).events?.length, 0);
    f.set(bar(14, 280, { previous: { time: 220, close: 13 } }));
    assert.equal((await f.manager.events(f.id, closed.cursor)).events?.[0].type, 'sampling_gap');
  });
  for (const change of [{ identity: 'page:2' }, { symbol: 'EX:B' }, { resolution: '5' }]) {
    it(`stops on chart identity change ${JSON.stringify(change)}`, async () => {
      const f = await fixture();
      f.set(bar(12, 100, change));
      const result = await f.manager.events(f.id);
      assert.equal(result.stopped, true);
      assert.equal(result.events?.[0].type, 'identity_changed');
      const calls = f.calls();
      await f.manager.events(f.id);
      assert.equal(f.calls(), calls);
    });
  }
  it('bounds retention and reports exact cursor loss; reads are replayable', async () => {
    const f = await fixture({ kind: 'price_crossing', price: 10, capacity: 2 });
    for (const price of [11, 9, 11, 9]) { f.set(bar(price)); await f.manager.events(f.id); }
    const read = await f.manager.events(f.id, 0);
    assert.equal(read.dropped, 2);
    assert.equal(read.oldest_cursor, 3);
    assert.equal(read.cursor, 4);
    assert.equal(read.events?.length, 2);
    assert.deepEqual((await f.manager.events(f.id, 0)).events, read.events);
    assert.equal((await f.manager.events(f.id, 5)).success, false);
    assert.equal((await f.manager.events(f.id, -1)).success, false);
  });
  it('expires at TTL, frees capacity, and cleans up on stop/close', async () => {
    const f = await fixture({ kind: 'bar_close', ttl_ms: 10 });
    assert.equal((await f.manager.start({ kind: 'bar_close' })).success, true);
    assert.equal((await f.manager.start({ kind: 'bar_close' })).success, false);
    f.time(10);
    assert.equal((await f.manager.events(f.id)).success, false);
    const replacement = await f.manager.start({ kind: 'bar_close' });
    assert.ok(replacement.watch_id);
    assert.equal((await f.manager.stop(replacement.watch_id)).removed, true);
    assert.equal((await f.manager.stop(replacement.watch_id)).removed, false);
    f.manager.close();
    assert.equal((await f.manager.start({ kind: 'bar_close' })).success, false);
  });
  it('does not sample after abort and resets baseline after errors or time going backwards', async () => {
    const f = await fixture();
    const controller = new AbortController(); controller.abort();
    assert.equal((await f.manager.events(f.id, 0, controller.signal)).success, false);
    assert.equal(f.calls(), 1);
    f.fail(true); assert.equal((await f.manager.events(f.id)).sampling_loss, true);
    f.fail(false); f.set(bar(12));
    assert.deepEqual((await f.manager.events(f.id)).events?.map(event => event.type), ['sampling_gap']);
    f.set(bar(8, 50));
    assert.equal((await f.manager.events(f.id, 1)).events?.[0].type, 'sampling_gap');
  });
  it('cannot retain an in-flight sample after close', async () => {
    let release!: (sample: Sample) => void;
    const manager = new WatchManager(() => new Promise(resolve => { release = resolve; }));
    const start = manager.start({ kind: 'bar_close' });
    await Promise.resolve();
    manager.close(); release(bar(9));
    assert.equal((await start).success, false);
  });
  it('rejects invalid limits and crossing price before sampling', async () => {
    const manager = new WatchManager(async () => { throw Error('must not sample'); });
    for (const options of [{ kind: 'price_crossing' as const }, { kind: 'bar_close' as const, capacity: 257 },
      { kind: 'bar_close' as const, ttl_ms: 0 }, { kind: 'bar_close' as const, ttl_ms: Infinity }]) {
      assert.equal((await manager.start(options)).success, false);
    }
  });
});

it('executes the actual browser sampler against bar/widget APIs, with weak widget identity', () => {
  let widget = { model: () => ({ mainSeries: () => ({ bars: () => ({ lastIndex: () => 8, valueAt: (i: number) => [i === 8 ? 160 : 100, 1, 2, 0, i === 8 ? 11 : 10] }) }) }) };
  const chart = { get _chartWidget() { return widget; }, symbol: () => 'EX:A', resolution: () => '1' };
  const context = { window: { TradingViewApi: { _activeChartWidgetWV: { value: () => chart } } }, crypto };
  const first = runInNewContext(SAMPLE_JS, context) as Sample;
  assert.equal(first.time, 160); assert.equal(first.previous?.close, 10);
  assert.equal((runInNewContext(SAMPLE_JS, context) as Sample).identity, first.identity);
  widget = { ...widget };
  assert.notEqual((runInNewContext(SAMPLE_JS, context) as Sample).identity, first.identity);
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerMonitorTools } from '../src/tools/monitor.js';
it('clears watches when the MCP transport closes', async () => {
  const manager = new WatchManager(async () => bar(9));
  const server = new McpServer({ name: 'test', version: '0' });
  registerMonitorTools(server, manager);
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const started = await manager.start({ kind: 'bar_close' });
  assert.ok(started.watch_id);
  await client.close();
  assert.equal((await manager.events(started.watch_id)).success, false);
  assert.equal((await manager.start({ kind: 'bar_close' })).success, false);
});

it('honors cancellation before and during watch initialization', async () => {
  const controller = new AbortController();
  controller.abort();
  const unavailable = new WatchManager(async () => { throw Error('must not sample'); });
  assert.equal((await unavailable.start({ kind: 'bar_close' }, controller.signal)).success, false);
  let release!: (sample: Sample) => void;
  const manager = new WatchManager(() => new Promise(resolve => { release = resolve; }));
  const pending = new AbortController();
  const start = manager.start({ kind: 'bar_close' }, pending.signal);
  await Promise.resolve();
  pending.abort(); release(bar(9));
  assert.equal((await start).success, false);
});

it('serializes overlapping reads so a crossover is emitted once', async () => {
  const f = await fixture();
  f.set(bar(11));
  const [a, b] = await Promise.all([f.manager.events(f.id), f.manager.events(f.id)]);
  assert.equal(a.cursor, 1);
  assert.equal(b.cursor, 1);
  assert.deepEqual(a.events, b.events);
});
