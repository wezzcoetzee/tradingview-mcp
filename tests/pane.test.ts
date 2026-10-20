import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { focus, setSymbol } from '../src/core/pane.js';

const waitOpts = { timeout: 50, interval: 10 };

/** Fake page: the focus click succeeds and the active-pane probe reports `activeIndex`. */
function paneDeps(activeIndex: number, symbol = 'AAPL') {
  const calls: string[] = [];
  const evaluate = async (expr: string) => {
    calls.push(expr);
    if (expr.includes('_mainDiv')) return { focused: 1, total: 2 };
    if (expr.includes('mainSeries().symbol()')) return symbol;
    if (expr.includes('active._chartWidget')) return activeIndex;
    return undefined;
  };
  return { _deps: { evaluate, waitOpts }, calls };
}

describe('pane focus', () => {
  it('succeeds once the pane is active', async () => {
    const result: Record<string, any> = await focus({ index: 1, _deps: paneDeps(1)._deps });
    assert.deepEqual([result.success, result.focused_index], [true, 1]);
  });

  it('reports expected vs seen when another pane stays active', async () => {
    const result: Record<string, any> = await focus({ index: 1, _deps: paneDeps(0)._deps });
    assert.deepEqual([result.success, result.expected, result.seen], [false, 1, 0]);
  });
});

describe('pane setSymbol', () => {
  it('returns the focus failure without touching the symbol', async () => {
    const { _deps, calls } = paneDeps(0);
    const result: Record<string, any> = await setSymbol({ index: 1, symbol: 'AAPL', _deps });
    assert.deepEqual([result.success, result.index], [false, 1]);
    assert.equal(calls.some(c => c.includes('.setSymbol(')), false);
  });

  it('sets the symbol after a verified focus', async () => {
    const result: Record<string, any> = await setSymbol({ index: 1, symbol: 'AAPL', _deps: paneDeps(1)._deps });
    assert.equal(result.success, true);
  });
});
