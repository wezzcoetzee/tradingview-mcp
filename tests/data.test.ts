import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import {
  getQuote, getOhlcv, getTrades, getStrategyResults, getEquity,
  getPineLabels, getPineTables, getStudyValues, getPineLines, horizontalLevels, tableRows,
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

  it('tableRows keeps a blank row between filled rows so indices stay aligned', () => {
    const cell = (row: number, t: string) => ({ id: row, raw: { tid: 1, row, col: 0, t } });
    const [table] = tableRows([cell(0, 'A'), cell(2, 'C')]);
    assert.deepEqual(table.rows, ['A', '', 'C']);
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

  it('horizontalLevels currentOnly drops lines that stop before the latest bar', () => {
    const line = (y: number, x2: number) => ({ id: y, raw: { y1: y, y2: y, x2 } });
    const items = [line(1, 10), line(2, 100), line(3, 100)];
    assert.deepEqual(horizontalLevels(items, 50, true), [3, 2]);
    assert.deepEqual(horizontalLevels(items), [3, 2, 1]);
  });

  it('horizontalLevels currentOnly ignores forward-projected sloped lines and missing x2', () => {
    const line = (y1: number, y2: number, x2?: number) => ({ id: y1 + y2, raw: { y1, y2, x2 } });
    const items = [line(1, 1, 50), line(2, 2, 50), line(3, 9, 500), line(4, 4)];
    assert.deepEqual(horizontalLevels(items, 50, true), [2, 1]);
    assert.deepEqual(horizontalLevels([line(4, 4)], 50, true), []);
  });

  it('getPineLines reports current_levels as a subset of horizontal_levels', async () => {
    const line = (y: number, x2: number) => ({ id: y, raw: { y1: y, y2: y, x2 } });
    const _deps = graphics([{ name: 'Alpha Levels', count: 2, items: [line(1, 10), line(2, 100)] }]);
    const res = await getPineLines({ _deps });
    assert.deepEqual(res.studies[0].horizontal_levels, [2, 1]);
    assert.deepEqual(res.studies[0].current_levels, [2]);
  });

  it('getStudyValues filters by name and hints on a miss', async () => {
    const studies = [{ entity_id: 'a', name: 'RSI', values: { RSI: '50' } }];
    const hit = await getStudyValues({ study_filter: 'rsi', _deps: graphics(studies, ['RSI', 'MACD']) });
    assert.equal(hit.study_count, 1);
    assert.equal(hit.warning, undefined);
    const miss = await getStudyValues({ study_filter: 'nope', _deps: graphics([], ['RSI', 'MACD']) });
    assert.deepEqual(miss.available_studies, ['RSI', 'MACD']);
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

  it('reports a failed restore without masking iteration results', async () => {
    let calls = 0;
    const { deps } = baseDeps({
      waitForChartReady: async () => (++calls === 1 ? { ok: true, value: undefined } : { ok: false, value: { symbol: 'AAPL', resolution: 'D', bars: 1 } }),
    });
    const res = await batchRun({ symbols: ['AAPL'], action: 'get_ohlcv', delay_ms: 0, _deps: deps });
    assert.equal(res.restored, false);
    assert.equal(res.restore_seen, 'AAPL D');
    assert.equal(res.results.length, 1);
  });

  it('reports restored: false when the original state could not be read', async () => {
    const { deps } = baseDeps({ evaluate: async () => { throw new Error('boom'); }, getChartCollection: async () => 'COL' });
    const res = await batchRun({ symbols: ['AAPL'], action: 'get_ohlcv', delay_ms: 0, _deps: deps });
    assert.equal(res.restored, false);
    assert.equal(res.restore_seen, 'original state unknown');
  });

  it('reports restored: true on a clean restore', async () => {
    const { deps } = baseDeps();
    const res = await batchRun({ symbols: ['AAPL'], action: 'get_ohlcv', delay_ms: 0, _deps: deps });
    assert.equal(res.restored, true);
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
