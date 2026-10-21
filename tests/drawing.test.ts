/**
 * Unit tests for src/core/drawing.js — covers all five exported functions
 * via dependency injection so no live TradingView/CDP connection is needed.
 *
 * Regression target: the import-alias bug where listDrawings/getProperties/
 * removeOne/clearAll referenced undefined `evaluate`/`getChartApi` symbols
 * (issue #23).
 */
import { describe, it } from 'bun:test';
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

  const fastDeps = (evaluate: (expr: string) => unknown) => ({
    evaluate: async (expr: string) => evaluate(expr),
    getChartApi: async () => 'window.__api',
    waitOpts: { timeout: 50, interval: 10 },
  });

  it('fails when no new shape appears', async () => {
    const result = await drawShape({ shape: 'horizontal_line', point: { time: 1, price: 2 }, _deps: fastDeps(() => []) });
    assert.equal(result.success, false);
    assert.equal(result.entity_id, null);
  });

  it('throws a clear message when point is missing', async () => {
    await assert.rejects(
      drawShape({ shape: 'horizontal_line', _deps: fastDeps(() => []) }),
      /point is required/,
    );
  });

  it('throws a clear message when overrides is not a JSON object', async () => {
    await assert.rejects(
      drawShape({ shape: 'horizontal_line', point: { time: 1, price: 2 }, overrides: '{bad', _deps: fastDeps(() => []) }),
      /overrides must be a JSON object/,
    );
  });
});

describe('removeOne() — truthful result', () => {
  it('fails when the shape is still present after removal', async () => {
    const _deps = {
      evaluate: async () => ({ removed: false, entity_id: 'xyz', remaining_shapes: 1 }),
      getChartApi: async () => 'window.__api',
    };
    const result = await removeOne({ entity_id: 'xyz', _deps });
    assert.equal(result.success, false);
    assert.equal(result.removed, false);
  });
});

describe('drawShape() points and lock', () => {
  function drawDeps(locked = true) {
    const calls: string[] = [];
    let created = false;
    const evaluate = async (expr: string) => {
      calls.push(expr);
      if (expr.includes('createShape') || expr.includes('createMultipointShape')) { created = true; return undefined; }
      if (expr.includes('isLocked')) return locked;
      if (expr.includes('getAllShapes')) return created ? ['old', 'new1'] : ['old'];
      return undefined;
    };
    return { calls, _deps: { evaluate, getChartApi: async () => 'window.__api', waitOpts: { timeout: 50, interval: 5 } } };
  }
  const p = (time: number, price: number) => ({ time, price });

  it('passes three points to createMultipointShape in order', async () => {
    const { _deps, calls } = drawDeps();
    const res = await drawShape({ shape: 'parallel_channel', point: p(1, 10), point2: p(2, 20), more_points: [p(3, 15)], _deps });
    assert.equal(res.success, true);
    const create = calls.find(c => c.includes('createMultipointShape'))!;
    assert.ok(create.includes('[{"time":1,"price":10},{"time":2,"price":20},{"time":3,"price":15}]'));
  });

  it('rejects more_points without point2 and non-finite extra points', async () => {
    const { _deps } = drawDeps();
    await assert.rejects(drawShape({ shape: 'x', point: p(1, 1), more_points: [p(2, 2)], _deps }), /needs point2/);
    await assert.rejects(drawShape({ shape: 'x', point: p(1, 1), point2: p(2, 2), more_points: [{ time: 3, price: NaN }], _deps }), /more_points\[0\]\.price/);
  });

  it('lock is sent to the chart and verified by reading it back', async () => {
    const ok = drawDeps(true);
    const res = await drawShape({ shape: 'trend_line', point: p(1, 1), point2: p(2, 2), lock: true, _deps: ok._deps });
    assert.equal(res.success, true);
    assert.equal(res.locked, true);
    assert.ok(ok.calls.find(c => c.includes('createMultipointShape'))!.includes('lock: true'));
    const bad = await drawShape({ shape: 'trend_line', point: p(1, 1), lock: true, _deps: drawDeps(false)._deps });
    assert.equal(bad.success, false);
    assert.match(bad.error, /not locked/);
  });
});

describe('draw_list points and draw_get_properties verbose', () => {
  it('draw_list asks for each shape\'s points', async () => {
    const { _deps, calls } = makeDeps(() => []);
    await listDrawings({ _deps });
    assert.ok(calls[0].includes('getPoints()'));
  });

  it('available_methods are only collected when verbose', async () => {
    const quiet = makeDeps(() => ({ entity_id: 'a' }));
    await getProperties({ entity_id: 'a', _deps: quiet._deps });
    assert.ok(!quiet.calls[0].includes('available_methods'));
    const loud = makeDeps(() => ({ entity_id: 'a' }));
    await getProperties({ entity_id: 'a', verbose: true, _deps: loud._deps });
    assert.ok(loud.calls[0].includes('available_methods'));
  });
});
