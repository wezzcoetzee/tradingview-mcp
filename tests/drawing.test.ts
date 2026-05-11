/**
 * Unit tests for src/core/drawing.js — covers all five exported functions
 * via dependency injection so no live TradingView/CDP connection is needed.
 *
 * Regression target: the import-alias bug where listDrawings/getProperties/
 * removeOne/clearAll referenced undefined `evaluate`/`getChartApi` symbols
 * (issue #23).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawShape,
  listDrawings,
  getProperties,
  removeOne,
  clearAll,
} from '../src/core/drawing.js';

function makeDeps(evalImpl?: any) {
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    return evalImpl ? evalImpl(expr, calls.length - 1) : undefined;
  };
  return {
    _deps: { evaluate, getChartApi: async () => 'window.__api' },
    calls,
  };
}

describe('listDrawings()', () => {
  it('returns shapes from getAllShapes()', async () => {
    const { _deps } = makeDeps(() => [
      { id: 'a', name: 'horizontal_line' },
      { id: 'b', name: 'rectangle' },
    ]);
    const result = await listDrawings({ _deps });
    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.deepEqual(result.shapes, [
      { id: 'a', name: 'horizontal_line' },
      { id: 'b', name: 'rectangle' },
    ]);
  });

  it('handles empty shape list', async () => {
    const { _deps } = makeDeps(() => []);
    const result = await listDrawings({ _deps });
    assert.equal(result.count, 0);
    assert.deepEqual(result.shapes, []);
  });

  it('throws when evaluate rejects', async () => {
    const _deps = {
      evaluate: async () => { throw new Error('CDP disconnected'); },
      getChartApi: async () => 'window.__api',
    };
    await assert.rejects(listDrawings({ _deps }), /CDP disconnected/);
  });
});

describe('clearAll()', () => {
  it('invokes removeAllShapes() on the chart API', async () => {
    const { _deps, calls } = makeDeps();
    const result = await clearAll({ _deps });
    assert.equal(result.success, true);
    assert.equal(result.action, 'all_shapes_removed');
    assert.match(calls[0], /removeAllShapes\(\)/);
  });
});

describe('removeOne()', () => {
  it('removes a shape that exists', async () => {
    let step = 0;
    const _deps = {
      evaluate: async () => {
        step++;
        return step === 1
          ? { removed: true, entity_id: 'xyz', remaining_shapes: 1 }
          : undefined;
      },
      getChartApi: async () => 'window.__api',
    };
    const result = await removeOne({ entity_id: 'xyz', _deps });
    assert.equal(result.success, true);
    assert.equal(result.removed, true);
    assert.equal(result.entity_id, 'xyz');
  });

  it('throws when the shape is not found', async () => {
    const _deps = {
      evaluate: async () => ({ error: 'Shape not found: missing', available: [] }),
      getChartApi: async () => 'window.__api',
    };
    await assert.rejects(removeOne({ entity_id: 'missing', _deps }), /Shape not found/);
  });
});

describe('getProperties()', () => {
  it('returns shape properties merged into result', async () => {
    const _deps = {
      evaluate: async () => ({
        entity_id: 'abc',
        points: [{ time: 1, price: 100 }],
        visible: true,
      }),
      getChartApi: async () => 'window.__api',
    };
    const result = await getProperties({ entity_id: 'abc', _deps });
    assert.equal(result.success, true);
    assert.equal(result.entity_id, 'abc');
    assert.equal(result.visible, true);
    assert.deepEqual(result.points, [{ time: 1, price: 100 }]);
  });

  it('throws when the underlying lookup reports an error', async () => {
    const _deps = {
      evaluate: async () => ({ error: 'Shape not found: zzz' }),
      getChartApi: async () => 'window.__api',
    };
    await assert.rejects(getProperties({ entity_id: 'zzz', _deps }), /Shape not found/);
  });
});

describe('drawShape() — sanity', () => {
  it('creates a single-point shape and returns the new entity id', async () => {
    let i = 0;
    const _deps = {
      evaluate: async () => {
        i++;
        if (i === 1) return [];                    // before
        if (i === 2) return undefined;             // createShape
        return ['new-id'];                         // after
      },
      getChartApi: async () => 'window.__api',
    };
    const result = await drawShape({
      shape: 'horizontal_line',
      point: { time: 1700000000, price: 42.5 },
      _deps,
    });
    assert.equal(result.success, true);
    assert.equal(result.entity_id, 'new-id');
  });
});
