import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import {
  getQuote, getOhlcv, getTrades, getStrategyResults, getEquity,
  getPineLabels, getPineTables, getPineLines, getPineBoxes, horizontalLevels, tableRows,
  downsample, summarizeEquity, boxZones, summarizeBars,
} from '../src/core/data.js';
import { batchRun } from '../src/core/batch.js';
import { backoffMs, sleep, pollLoop } from '../src/core/stream.js';

const mock = (value: unknown) => ({ evaluate: async () => value });
const graphics = (studies: unknown[], available = ['Alpha Levels']) => mock({ studies, available });

describe('getQuote', () => {
  const quote = { symbol: 'NASDAQ:AAPL', close: 10, last: 10 };

  it('accepts a matching symbol, with or without exchange', async () => {
    assert.equal((await getQuote({ symbol: 'AAPL', _deps: mock(quote) })).success, true);
  });

  it('rejects a symbol that is not on the chart', async () => {
    await assert.rejects(getQuote({ symbol: 'MSFT', _deps: mock(quote) }), /chart_set_symbol/);
  });
});

describe('getOhlcv', () => {
  it('passes the real connection error through', async () => {
    const _deps = { evaluate: async () => { throw new Error('CDP not connected'); } };
    await assert.rejects(getOhlcv({ _deps }), /CDP not connected/);
  });
});

describe('strategy readers', () => {
  it('return success:false when the chart has no strategy', async () => {
    const _deps = mock({ error: 'No strategy found on chart.' });
    assert.equal((await getStrategyResults({ _deps })).success, false);
    assert.equal((await getTrades({ _deps })).success, false);
    assert.equal((await getEquity({ _deps })).success, false);
  });

  it('getTrades defaults to the latest trades and reports total/offset', async () => {
    let expression = '';
    const _deps = { evaluate: async (e: string) => { expression = e; return { trades: [], total: 50, offset: 30, source: 'internal_api' }; } };
    const res = await getTrades({ max_trades: 20, _deps });
    assert.ok(expression.includes('Math.max(0, total - 20)'));
    assert.equal(res.total, 50);
    assert.equal(res.offset, 30);
    await getTrades({ offset: 5, _deps });
    assert.ok(expression.includes('var from = 5;'));
  });
});

describe('pine graphics readers', () => {
  const label = (t: string) => ({ id: t, raw: { t, y: 1 } });

  it('max_labels: 0 returns no labels', async () => {
    const _deps = graphics([{ name: 'Alpha Levels', count: 2, items: [label('a'), label('b')] }]);
    const res = await getPineLabels({ max_labels: 0, _deps });
    assert.deepEqual(res.studies[0].labels, []);
  });

  it('max_labels keeps the newest labels', async () => {
    const _deps = graphics([{ name: 'Alpha Levels', count: 3, items: [label('a'), label('b'), label('c')] }]);
    const res = await getPineLabels({ max_labels: 2, _deps });
    assert.deepEqual(res.studies[0].labels.map(l => l.text), ['b', 'c']);
  });

  it('a filter miss lists the available study names', async () => {
    const res = await getPineLines({ study_filter: 'nope', _deps: graphics([], ['Alpha Levels', 'Beta']) });
    assert.deepEqual(res.available_studies, ['Alpha Levels', 'Beta']);
    assert.match(res.warning, /nope/);
  });

  it('a case-insensitive hit carries no warning', async () => {
    const res = await getPineLines({ study_filter: 'ALPHA', _deps: graphics([]) });
    assert.equal(res.warning, undefined);
  });

  it('tableRows keeps empty cells so columns stay aligned', () => {
    const cell = (row: number, col: number, t: string) => ({ id: `${row}${col}`, raw: { tid: 1, row, col, t } });
    const [table] = tableRows([cell(0, 0, 'A'), cell(0, 1, ''), cell(0, 2, 'C'), cell(1, 0, ''), cell(1, 1, ''), cell(1, 2, '')]);
    assert.deepEqual(table.rows, ['A |  | C']);
  });

  it('getPineTables formats tables', async () => {
    const items = [{ id: 1, raw: { tid: 1, row: 0, col: 0, t: 'X' } }];
    const res = await getPineTables({ _deps: graphics([{ name: 'Alpha Levels', count: 1, items }]) });
    assert.deepEqual(res.studies[0].tables, [{ rows: ['X'] }]);
  });

  it('horizontalLevels handles price 0, skips sloped lines, and caps newest-first', () => {
    const line = (y1: number, y2: number) => ({ id: y1, raw: { y1, y2 } });
    assert.deepEqual(horizontalLevels([line(0, 0), line(5, 6), line(3, 3)]), [3, 0]);
    assert.deepEqual(horizontalLevels([line(1, 1), line(2, 2), line(3, 3)], 2), [3, 2]);
  });
});

describe('batchRun', () => {
  const ready = async () => ({ ok: true, value: undefined });
  const baseDeps = (over: Record<string, unknown> = {}) => {
    const calls: string[] = [];
    const deps = {
      evaluate: async (e: string) => {
        calls.push(e);
        if (e.includes('chart.symbol()')) return { symbol: 'BTCUSD', resolution: '60' };
        return null;
      },
      waitForChartReady: ready,
      getChartCollection: async () => 'COL',
      getChartApi: async () => 'API',
      ...over,
    };
    return { deps, calls };
  };

  it('rejects an unknown action before touching the chart', async () => {
    const { deps, calls } = baseDeps();
    await assert.rejects(batchRun({ symbols: ['AAPL'], action: 'bogus', _deps: deps }), /Unknown batch action/);
    assert.equal(calls.length, 0);
  });

  it('restores the original symbol and timeframe, and honours delay_ms 0', async () => {
    const { deps, calls } = baseDeps();
    const started = Date.now();
    await batchRun({ symbols: ['AAPL'], timeframes: ['D'], action: 'get_strategy_results', delay_ms: 0, _deps: deps });
    assert.ok(Date.now() - started < 1900);
    assert.equal(calls.at(-2), 'COL.setSymbol("BTCUSD")');
    assert.equal(calls.at(-1), 'COL.setResolution("60")');
  });

  it('counts a chart that never became ready as a failure', async () => {
    const { deps } = baseDeps({ waitForChartReady: async () => ({ ok: false, value: { symbol: 'BTCUSD', resolution: '60', bars: 1 } }) });
    const res = await batchRun({ symbols: ['AAPL'], action: 'get_ohlcv', delay_ms: 0, _deps: deps });
    assert.equal(res.success, false);
    assert.equal(res.failed, 1);
    assert.match(res.results[0].error, /did not reach AAPL/);
  });

  it('counts an action-level error as a failure', async () => {
    const { deps } = baseDeps({
      evaluate: async (e: string) => (e.includes('chart.symbol()') ? { symbol: 'X', resolution: 'D' } : { error: 'Strategy Tester not found' }),
    });
    const res = await batchRun({ symbols: ['AAPL'], action: 'get_strategy_results', delay_ms: 0, _deps: deps });
    assert.equal(res.success, false);
    assert.equal(res.results[0].error, 'Strategy Tester not found');
  });
});

describe('stream helpers', () => {
  it('backoff doubles per consecutive error and is capped', () => {
    assert.equal(backoffMs(1, 500), 1000);
    assert.equal(backoffMs(3, 500), 4000);
    assert.equal(backoffMs(20, 500), 30_000);
  });

  it('sleep resolves immediately for an already aborted signal', async () => {
    const started = Date.now();
    await sleep(5000, AbortSignal.abort());
    assert.ok(Date.now() - started < 500);
  });

  it('pollLoop gives up after consecutive errors of any kind', async () => {
    let calls = 0;
    await pollLoop(async () => { calls++; throw new Error('boom'); }, { interval: 1, maxErrors: 3 });
    assert.equal(calls, 3);
  });
});

describe('size controls', () => {
  const points = Array.from({ length: 1000 }, (_, i) => ({ time: i, equity: 100 + (i % 7) }));

  it('downsample keeps first and last and respects the cap', () => {
    const out = downsample(points, 10);
    assert.equal(out.length, 10);
    assert.equal(out[0], points[0]);
    assert.equal(out[9], points[999]);
    assert.equal(downsample(points.slice(0, 3), 10).length, 3);
    assert.deepEqual(downsample(points, 1), [points[999]]);
  });

  it('summarizeEquity reports first, last, min and max', () => {
    const s = summarizeEquity([{ time: 1, equity: 5 }, { time: 2, equity: 9 }, { time: 3, equity: 2 }, { time: 4, equity: 6 }]);
    assert.equal(s?.first.time, 1);
    assert.equal(s?.last.time, 4);
    assert.equal(s?.min.equity, 2);
    assert.equal(s?.max.equity, 9);
    assert.equal(summarizeEquity([{ time: 1 }]), null);
  });

  it('getEquity downsamples by default cap, honours max_points, and summary drops the points', async () => {
    const _deps = mock({ data: points, source: 'internal_api' });
    const capped = await getEquity({ max_points: 25, _deps });
    assert.equal(capped.data_points, 1000);
    assert.equal(capped.showing, 25);
    assert.equal(capped.data.length, 25);
    assert.equal((await getEquity({ _deps })).data.length, 200);
    const only = await getEquity({ summary: true, _deps });
    assert.deepEqual(only.data, []);
    assert.equal(only.summary?.max.equity, 106);
  });

  it('boxZones dedupes, keeps the newest, caps, and sorts high to low', () => {
    const box = (y1: number, y2: number) => ({ id: `${y1}-${y2}`, raw: { y1, y2 } });
    const items = [box(1, 2), box(5, 4), box(3, 3.5), box(2, 1), box(8, 9)];
    assert.deepEqual(boxZones(items), [{ high: 9, low: 8 }, { high: 5, low: 4 }, { high: 3.5, low: 3 }, { high: 2, low: 1 }]);
    assert.deepEqual(boxZones(items, 2), [{ high: 9, low: 8 }, { high: 2, low: 1 }]);
  });

  it('getPineBoxes applies max_levels to zones and verbose boxes', async () => {
    const items = [1, 2, 3, 4].map(n => ({ id: n, raw: { y1: n, y2: n + 0.5 } }));
    const _deps = graphics([{ name: 'Alpha Levels', count: 4, items }]);
    const res = await getPineBoxes({ max_levels: 2, verbose: true, _deps });
    assert.equal(res.studies[0].zones.length, 2);
    assert.equal(res.studies[0].all_boxes.length, 2);
  });
});

describe('ohlcv range and summary', () => {
  const bar = (time: number) => ({ time, open: 10, high: 12, low: 9, close: 11, volume: 100 });

  it('summary carries symbol, resolution and ISO period', () => {
    const s = summarizeBars([bar(0), bar(86400)], { symbol: 'BTCUSD', resolution: '60' });
    assert.equal(s.symbol, 'BTCUSD');
    assert.equal(s.resolution, '60');
    assert.equal(s.period.from_iso, '1970-01-01T00:00:00.000Z');
    assert.equal(s.period.to_iso, '1970-01-02T00:00:00.000Z');
  });

  it('puts from/to into the page expression and rejects an inverted range', async () => {
    let expression = '';
    const _deps = { evaluate: async (e: string) => { expression = e; return { bars: [bar(5)], total_bars: 1, symbol: 'X', resolution: 'D' }; } };
    const res = await getOhlcv({ from: 100, to: 200, _deps });
    assert.ok(expression.includes('v[0] > 200') && expression.includes('v[0] < 100'));
    assert.equal(res.symbol, 'X');
    await assert.rejects(getOhlcv({ from: 200, to: 100, _deps }), /must not be after/);
  });

  it('explains an empty range instead of a loading error', async () => {
    await assert.rejects(getOhlcv({ from: 1, to: 2, _deps: mock({ bars: [] }) }), /No loaded bars in the requested/);
  });
});

describe('strategy study_filter', () => {
  it('is lowercased into the page expression for all strategy readers', async () => {
    const seen: string[] = [];
    const _deps = { evaluate: async (e: string) => { seen.push(e); return { error: 'none' }; } };
    await getStrategyResults({ study_filter: 'MyStrat', _deps });
    await getTrades({ study_filter: 'MyStrat', _deps });
    await getEquity({ study_filter: 'MyStrat', _deps });
    assert.equal(seen.length, 3);
    for (const e of seen) assert.ok(e.includes('findStrategy(sources, "mystrat")'));
  });
});
