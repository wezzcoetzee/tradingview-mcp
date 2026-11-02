import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { waitFor, waitForChartReady, symbolMatches, resolutionMatches, legendMatches } from '../src/wait.js';
import { jsonResult } from '../src/tools/_format.js';

const sequence = (values: unknown[]) => {
  let i = 0;
  return async () => values[Math.min(i++, values.length - 1)];
};

describe('waitFor', () => {
  it('resolves once the predicate holds', async () => {
    const r = await waitFor<number>('x', v => v >= 3, { interval: 1, evaluate: sequence([1, 2, 3]) });
    assert.deepEqual(r, { ok: true, value: 3 });
  });

  it('times out with the last value seen', async () => {
    const r = await waitFor<number>('x', v => v > 10, { timeout: 20, interval: 5, evaluate: sequence([1, 2]) });
    assert.deepEqual(r, { ok: false, value: 2 });
  });

  it('treats evaluation errors as not ready', async () => {
    let calls = 0;
    const evaluate = async () => { if (calls++ === 0) throw new Error('reloading'); return true; };
    const r = await waitFor<boolean>('x', Boolean, { interval: 1, evaluate });
    assert.equal(r.ok, true);
  });
});

describe('waitForChartReady', () => {
  it('waits for the expected timeframe and stable bars', async () => {
    const evaluate = sequence([
      { symbol: 'NASDAQ:AAPL', resolution: '1D', bars: 300 },
      { symbol: 'NASDAQ:AAPL', resolution: '60', bars: 100 },
      { symbol: 'NASDAQ:AAPL', resolution: '60', bars: 300 },
      { symbol: 'NASDAQ:AAPL', resolution: '60', bars: 300 },
      { symbol: 'NASDAQ:AAPL', resolution: '60', bars: 300 },
    ]);
    const r = await waitForChartReady('AAPL', '60', 1000, { interval: 1, evaluate });
    assert.equal(r.ok, true);
    assert.equal(r.value?.resolution, '60');
  });

  it('fails when the chart never switches', async () => {
    const evaluate = sequence([{ symbol: 'AAPL', resolution: '1D', bars: 300 }]);
    const r = await waitForChartReady(null, '60', 20, { interval: 5, evaluate });
    assert.equal(r.ok, false);
    assert.equal(r.value?.resolution, '1D');
  });

  const zec = { symbol: 'COINBASE:ZECUSD', resolution: '1D', bars: 300, description: 'Zcash / US Dollar' };

  it('waits for a visible legend to catch up with the API symbol', async () => {
    const evaluate = sequence([
      ...Array(3).fill({ ...zec, legend: 'SOL / TetherUS', hidden: false }),
      ...Array(3).fill({ ...zec, legend: 'Zcash / US Dollar', hidden: false }),
    ]);
    const r = await waitForChartReady('ZECUSD', null, 1000, { interval: 1, evaluate });
    assert.equal(r.ok, true);
    assert.equal(r.value?.legend, 'Zcash / US Dollar');
  });

  it('fails while a visible legend keeps showing the old symbol', async () => {
    const evaluate = sequence([{ ...zec, legend: 'SOL / TetherUS', hidden: false }]);
    const r = await waitForChartReady('ZECUSD', null, 20, { interval: 1, evaluate });
    assert.equal(r.ok, false);
  });

  it('does not wait on the legend of a hidden window, which cannot repaint', async () => {
    const evaluate = sequence([{ ...zec, legend: 'SOL / TetherUS', hidden: true }]);
    const r = await waitForChartReady('ZECUSD', null, 1000, { interval: 1, evaluate });
    assert.equal(r.ok, true);
    assert.equal(r.value?.hidden, true);
  });

  it('accepts a legend showing the ticker or no legend at all', () => {
    assert.ok(legendMatches({ ...zec, legend: 'ZECUSD' }));
    assert.ok(legendMatches({ ...zec, legend: null }));
    assert.ok(!legendMatches({ ...zec, legend: 'SOL / TetherUS' }));
  });

  it('matches symbols and resolutions loosely', () => {
    assert.ok(symbolMatches('NASDAQ:AAPL', 'aapl'));
    assert.ok(!symbolMatches('NASDAQ:AAPL', 'AAP'));
    assert.ok(resolutionMatches('1D', 'D'));
    assert.ok(!resolutionMatches('1', 'D'));
  });
});

describe('jsonResult', () => {
  it('flags success:false payloads as errors', () => {
    assert.equal(jsonResult({ success: false }).isError, true);
    assert.equal(jsonResult({ success: true }).isError, undefined);
  });
});
