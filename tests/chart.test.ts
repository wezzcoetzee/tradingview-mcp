import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import {
  setSymbol, setTimeframe, setType, manageIndicator, setVisibleRange, scrollToDate, secondsPerBar,
} from '../src/core/chart.js';

const waitOpts = { timeout: 50, interval: 10 };

function deps(evaluate: (expr: string) => unknown = () => undefined, extra: object = {}) {
  const calls: string[] = [];
  const fn = async (expr: string) => { calls.push(expr); return evaluate(expr); };
  return { _deps: { evaluate: fn, evaluateAsync: fn, waitOpts, ...extra }, calls };
}

describe('setSymbol / setTimeframe', () => {
  it('report expected vs seen when the chart never gets there', async () => {
    const waitForChartReady = async () => ({ ok: false, value: { symbol: 'MSFT', resolution: '60', bars: 10 } });
    const sym = await setSymbol({ symbol: 'AAPL', _deps: deps(undefined, { waitForChartReady })._deps });
    assert.deepEqual([sym.success, sym.expected, sym.seen], [false, 'AAPL', 'MSFT']);
    const tf = await setTimeframe({ timeframe: '5', _deps: deps(undefined, { waitForChartReady })._deps });
    assert.deepEqual([tf.success, tf.expected, tf.seen], [false, '5', '60']);
  });

  it('succeed when the chart is ready', async () => {
    const waitForChartReady = async () => ({ ok: true, value: undefined });
    const result = await setSymbol({ symbol: 'AAPL', _deps: deps(undefined, { waitForChartReady })._deps });
    assert.equal(result.success, true);
  });
});

describe('setType', () => {
  it('rejects an empty chart_type instead of defaulting to Bars', async () => {
    await assert.rejects(setType({ chart_type: '', _deps: deps()._deps }), /chart_type is required/);
  });

  it('fails when the chart type reads back differently', async () => {
    const { _deps } = deps((expr) => (expr.includes('.chartType()') ? 1 : undefined));
    const result = await setType({ chart_type: 'Line', _deps });
    assert.deepEqual([result.success, result.expected, result.seen], [false, 2, 1]);
  });
});

describe('manageIndicator', () => {
  it('remove fails for an unknown study id without calling removeEntity', async () => {
    const { _deps, calls } = deps((expr) => (expr.includes('getAllStudies') ? ['a'] : undefined));
    const result = await manageIndicator({ action: 'remove', entity_id: 'ghost', _deps });
    assert.equal(result.success, false);
    assert.ok(!calls.some(c => c.includes('removeEntity')));
  });

  it('remove fails when the study is still there afterwards', async () => {
    const { _deps } = deps((expr) => (expr.includes('getAllStudies') ? ['a'] : undefined));
    const result = await manageIndicator({ action: 'remove', entity_id: 'a', _deps });
    assert.equal(result.success, false);
    assert.match(result.error, /still on the chart/);
  });

  it('add surfaces the createStudy error', async () => {
    const { _deps } = deps((expr) => {
      if (expr.includes('createStudy')) return { error: 'unknown study' };
      return [];
    });
    await assert.rejects(manageIndicator({ action: 'add', indicator: 'Nope', _deps }), /unknown study/);
  });

  it('add returns entity_id plus inputs_error when applying inputs fails', async () => {
    let created = false;
    const { _deps } = deps((expr) => {
      if (expr.includes('createStudy')) { created = true; return {}; }
      if (expr.includes('getAllStudies')) return created ? ['old', 'new'] : ['old'];
      return { updated_inputs: {}, available_inputs: ['length'], unknown_keys: ['len'] };
    });
    const result = await manageIndicator({ action: 'add', indicator: 'RSI', inputs: '{"len": 5}', _deps });
    assert.equal(result.success, false);
    assert.equal(result.entity_id, 'new');
    assert.match(result.inputs_error, /No inputs were updated/);
  });

  it('rejects malformed inputs JSON with a clear message', async () => {
    await assert.rejects(
      manageIndicator({ action: 'add', indicator: 'RSI', inputs: '{oops', _deps: deps()._deps }),
      /inputs must be a JSON object/,
    );
  });
});

describe('time range navigation', () => {
  const outside = { found: false, loaded_from: 1000, loaded_to: 2000 };

  it('setVisibleRange returns not_in_loaded_range when no bars match', async () => {
    const result: Record<string, any> = await setVisibleRange({ from: 5000, to: 6000, _deps: deps(() => outside)._deps });
    assert.equal(result.success, false);
    assert.equal(result.error, 'not_in_loaded_range');
    assert.deepEqual(result.loaded, { from: 1000, to: 2000 });
  });

  // 60-minute bars: tolerance is max(10% of span, 3 bars = 10800s)
  const loaded = { loaded_from: 900_000, loaded_to: 1_200_000 };
  const zoomedTo = (zoomed_from: number, zoomed_to: number) => ({ found: true, ...loaded, zoomed_from, zoomed_to });
  const rangeEval = (zoom: object, visible: object) => (expr: string) => {
    if (expr.includes('zoomToBarsRange')) return zoom;
    return expr.includes('.resolution()') ? '60' : visible;
  };

  it('setVisibleRange succeeds once the visible range covers the zoomed bars, without a partial flag', async () => {
    const { _deps } = deps(rangeEval(zoomedTo(1_000_000, 1_100_000), { from: 995_000, to: 1_105_000 }));
    const result: Record<string, any> = await setVisibleRange({ from: 1_000_000, to: 1_100_000, _deps });
    assert.equal(result.success, true);
    assert.equal(result.partially_loaded, undefined);
  });

  it('setVisibleRange accepts a one-bar range padded by a few bars', async () => {
    const { _deps } = deps(rangeEval(zoomedTo(1_000_000, 1_000_000), { from: 990_000, to: 1_010_000 }));
    const result: Record<string, any> = await setVisibleRange({ from: 1_000_000, to: 1_000_000, _deps });
    assert.equal(result.success, true);
  });

  it('setVisibleRange flags a request that extends past the loaded bars', async () => {
    const { _deps } = deps(rangeEval(zoomedTo(1_000_000, 1_100_000), { from: 1_000_000, to: 1_100_000 }));
    const result: Record<string, any> = await setVisibleRange({ from: 500_000, to: 1_100_000, _deps });
    assert.equal(result.success, true);
    assert.equal(result.partially_loaded, true);
    assert.deepEqual(result.loaded, { from: 900_000, to: 1_200_000 });
  });

  it('setVisibleRange fails with expected vs seen when the visible range does not cover the bars', async () => {
    const seen = { from: 1_005_000, to: 1_100_000 };
    const { _deps } = deps(rangeEval(zoomedTo(1_000_000, 1_100_000), seen));
    const result: Record<string, any> = await setVisibleRange({ from: 1_000_000, to: 1_100_000, _deps });
    assert.equal(result.success, false);
    assert.deepEqual(result.expected, { from: 1_000_000, to: 1_100_000 });
    assert.deepEqual(result.seen, seen);
  });

  it('setVisibleRange fails when the visible range is far wider than the zoomed bars', async () => {
    const { _deps } = deps(rangeEval(zoomedTo(1_000_000, 1_100_000), { from: 0, to: 1_100_000 }));
    const result: Record<string, any> = await setVisibleRange({ from: 1_000_000, to: 1_100_000, _deps });
    assert.equal(result.success, false);
  });

  it('scrollToDate succeeds, then flags and fails like setVisibleRange', async () => {
    const window = zoomedTo(1_000_000, 1_100_000);
    const ok: Record<string, any> = await scrollToDate({
      date: '1050000', _deps: deps(rangeEval(window, { from: 1_000_000, to: 1_100_000 }))._deps,
    });
    assert.equal(ok.success, true);
    assert.equal(ok.partially_loaded, undefined);

    const partial: Record<string, any> = await scrollToDate({
      date: '905000', _deps: deps(rangeEval(window, { from: 1_000_000, to: 1_100_000 }))._deps,
    });
    assert.equal(partial.partially_loaded, true);

    const stuck: Record<string, any> = await scrollToDate({
      date: '1050000', _deps: deps(rangeEval(window, { from: 1_050_000, to: 1_060_000 }))._deps,
    });
    assert.equal(stuck.success, false);
    assert.deepEqual(stuck.expected, { from: 1_000_000, to: 1_100_000 });
  });

  it('scrollToDate returns not_in_loaded_range when no bars match', async () => {
    const { _deps } = deps((expr) => (expr.includes('zoomToBarsRange') ? outside : '60'));
    const result: Record<string, any> = await scrollToDate({ date: '2030-01-01', _deps });
    assert.equal(result.error, 'not_in_loaded_range');
  });

  it('scrollToDate treats 13-digit timestamps as milliseconds', async () => {
    const { _deps } = deps((expr) => (expr.includes('zoomToBarsRange') ? outside : 'D'));
    const result: Record<string, any> = await scrollToDate({ date: '1700000000000', _deps });
    assert.equal(result.error, 'not_in_loaded_range');
    assert.equal(result.requested.centered_on, 1700000000);
  });

  it('secondsPerBar reads 3M, 2D and 12M as months/days, plain numbers as minutes', () => {
    assert.equal(secondsPerBar('3M'), 3 * 2592000);
    assert.equal(secondsPerBar('12M'), 12 * 2592000);
    assert.equal(secondsPerBar('2D'), 2 * 86400);
    assert.equal(secondsPerBar('D'), 86400);
    assert.equal(secondsPerBar('1W'), 604800);
    assert.equal(secondsPerBar('30S'), 30);
    assert.equal(secondsPerBar('240'), 240 * 60);
  });
});
