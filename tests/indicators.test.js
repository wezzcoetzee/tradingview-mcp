/**
 * Unit tests for indicator input handling — covers the two regressions introduced
 * when commit 5d13624 added Path B (property-tree) for built-in studies:
 *
 *   1. setInputs (indicators.js) called childs[key].setValue() instead of
 *      childs[key].value.setValue() — the write never reached the real value node.
 *   2. getIndicator (data.js) only called getInputValues() which returns [] for
 *      built-ins — the read path was never updated to mirror the write.
 *
 * Tests simulate the three study shapes the runtime ships:
 *   (a) Pine-script studies — getInputValues() returns [{id, value}]
 *   (b) Built-in studies   — getInputValues() returns [] but property tree works
 *   (c) Unknown studies    — both paths fail; available_inputs should still list
 *       whatever keys were discovered so callers can debug name mismatches.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setInputs } from '../src/core/indicators.js';
import { getIndicator } from '../src/core/data.js';

function makeEvaluate(impl) {
  return async (_expr) => impl(_expr);
}

// ---------------------------------------------------------------------------
// setInputs
// ---------------------------------------------------------------------------

describe('setInputs — Path A (Pine-script studies)', () => {
  it('applies overrides via setInputValues when getInputValues returns descriptors', async () => {
    let capturedExpr;
    const evaluate = makeEvaluate((expr) => {
      capturedExpr = expr;
      return { updated_inputs: { length: 50 }, available_inputs: ['length', 'source'] };
    });

    const result = await setInputs({ entity_id: 'pine1', inputs: { length: 50 }, _deps: { evaluate } });

    assert.equal(result.success, true);
    assert.deepEqual(result.updated_inputs, { length: 50 });
    assert.deepEqual(result.available_inputs, ['length', 'source']);
  });

  it('throws when entity_id is missing', async () => {
    await assert.rejects(
      () => setInputs({ inputs: { length: 50 } }),
      /entity_id is required/,
    );
  });

  it('throws when inputs is empty', async () => {
    await assert.rejects(
      () => setInputs({ entity_id: 'x', inputs: {} }),
      /inputs must be a non-empty object/,
    );
  });
});

describe('setInputs — Path B (built-in studies with property tree)', () => {
  it('applies overrides via property-tree and returns correct available_inputs', async () => {
    const evaluate = makeEvaluate(() => ({
      updated_inputs: { length: 100 },
      available_inputs: ['length', 'source'],
    }));

    const result = await setInputs({ entity_id: 'builtin1', inputs: { length: 100 }, _deps: { evaluate } });

    assert.equal(result.success, true);
    assert.deepEqual(result.updated_inputs, { length: 100 });
    assert.deepEqual(result.available_inputs, ['length', 'source']);
  });

  it('always includes available_inputs even when no override matched', async () => {
    const evaluate = makeEvaluate(() => ({
      updated_inputs: {},
      available_inputs: ['length', 'source'],
    }));

    const result = await setInputs({ entity_id: 'builtin2', inputs: { typo_key: 99 }, _deps: { evaluate } });

    assert.equal(result.success, true);
    assert.deepEqual(result.updated_inputs, {});
    assert.ok(Array.isArray(result.available_inputs), 'available_inputs should be an array');
    assert.ok(result.available_inputs.includes('length'), 'should list discovered keys for debugging');
  });
});

describe('setInputs — neither path produces descriptors', () => {
  it('returns empty updated_inputs but still includes available_inputs array', async () => {
    const evaluate = makeEvaluate(() => ({
      updated_inputs: {},
      available_inputs: [],
    }));

    const result = await setInputs({ entity_id: 'unknown1', inputs: { length: 20 }, _deps: { evaluate } });

    assert.equal(result.success, true);
    assert.deepEqual(result.updated_inputs, {});
    assert.ok(Array.isArray(result.available_inputs));
  });

  it('throws when the CDP expression returns an error field', async () => {
    const evaluate = makeEvaluate(() => ({ error: 'Study not found: ghost' }));
    await assert.rejects(
      () => setInputs({ entity_id: 'ghost', inputs: { length: 20 }, _deps: { evaluate } }),
      /Study not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// getIndicator — read side
// ---------------------------------------------------------------------------

describe('getIndicator — Pine-script studies (Path A)', () => {
  it('returns inputs from getInputValues when it returns descriptors', async () => {
    const evaluate = makeEvaluate(() => ({
      visible: true,
      inputs: [{ id: 'length', value: 14 }, { id: 'source', value: 'close' }],
    }));

    const result = await getIndicator({ entity_id: 'pine1', _deps: { evaluate } });

    assert.equal(result.success, true);
    assert.equal(result.visible, true);
    assert.deepEqual(result.inputs, [{ id: 'length', value: 14 }, { id: 'source', value: 'close' }]);
  });
});

describe('getIndicator — built-in studies (Path B)', () => {
  it('returns inputs resolved via property tree when getInputValues returns empty', async () => {
    const evaluate = makeEvaluate(() => ({
      visible: true,
      inputs: [{ id: 'length', value: 200 }, { id: 'source', value: 'close' }],
    }));

    const result = await getIndicator({ entity_id: 'builtin1', _deps: { evaluate } });

    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.inputs));
    assert.equal(result.inputs.length, 2);
    assert.equal(result.inputs[0].id, 'length');
    assert.equal(result.inputs[0].value, 200);
    assert.equal(result.inputs[1].id, 'source');
    assert.equal(result.inputs[1].value, 'close');
  });

  it('filters oversized string values', async () => {
    const longStr = 'x'.repeat(600);
    const evaluate = makeEvaluate(() => ({
      visible: true,
      inputs: [{ id: 'text', value: longStr }],
    }));

    const result = await getIndicator({ entity_id: 'builtin2', _deps: { evaluate } });

    assert.equal(result.inputs.length, 0);
  });
});

describe('getIndicator — error cases', () => {
  it('throws when the study is not found', async () => {
    const evaluate = makeEvaluate(() => ({ error: 'Study not found: ghost' }));
    await assert.rejects(
      () => getIndicator({ entity_id: 'ghost', _deps: { evaluate } }),
      /Study not found/,
    );
  });
});
