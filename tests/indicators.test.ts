// Regressions from adding the property-tree path for built-in studies: setInputs wrote via
// childs[key].setValue() instead of the real value node, and getIndicator only read
// getInputValues() (empty for built-ins). Runtime study shapes are simulated via mocked evaluate.
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { setInputs } from '../src/core/indicators.js';
import { getIndicator } from '../src/core/data.js';

function makeEvaluate(impl: (expr: string) => unknown) {
  return async (expr: string) => impl(expr);
}

describe('setInputs', () => {
  it('applies overrides and returns updated and available inputs', async () => {
    const evaluate = makeEvaluate(() => ({ updated_inputs: { length: 50 }, available_inputs: ['length', 'source'] }));

    const result = await setInputs({ entity_id: 'pine1', inputs: { length: 50 }, _deps: { evaluate } });

    assert.equal(result.success, true);
    assert.deepEqual(result.updated_inputs, { length: 50 });
    assert.deepEqual(result.available_inputs, ['length', 'source']);
  });

  it('throws when entity_id is missing', async () => {
    await assert.rejects(
      () => setInputs({ inputs: { length: 50 } } as unknown as Parameters<typeof setInputs>[0]),
      /entity_id is required/,
    );
  });

  it('throws a clear message when inputs is not valid JSON', async () => {
    await assert.rejects(
      () => setInputs({ entity_id: 'x', inputs: '{length: 50', _deps: { evaluate: async () => ({}) } }),
      /inputs must be a JSON object/,
    );
  });

  it('throws when inputs is empty', async () => {
    await assert.rejects(
      () => setInputs({ entity_id: 'x', inputs: {} }),
      /inputs must be a non-empty object/,
    );
  });

  it('always includes available_inputs even when no override matched', async () => {
    const evaluate = makeEvaluate(() => ({
      updated_inputs: {},
      available_inputs: ['length', 'source'],
      unknown_keys: ['typo_key'],
    }));

    const result = await setInputs({ entity_id: 'builtin2', inputs: { typo_key: 99 }, _deps: { evaluate } });

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /No inputs were updated/);
    assert.deepEqual(result.unknown_keys, ['typo_key']);
    assert.ok(Array.isArray(result.available_inputs), 'available_inputs should be an array');
    assert.ok(result.available_inputs.includes('length'), 'should list discovered keys for debugging');
  });

  it('throws when the CDP expression returns an error field', async () => {
    const evaluate = makeEvaluate(() => ({ error: 'Study not found: ghost' }));
    await assert.rejects(
      () => setInputs({ entity_id: 'ghost', inputs: { length: 20 }, _deps: { evaluate } }),
      /Study not found/,
    );
  });
});

// Mocked evaluate can't run the in-page logic, so guard the shape that matters: writes go
// through the property tree, not .value.setValue() (which doesn't trigger recompute).
describe('setInputs — injected expression contract', () => {
  it('uses widget.getStudyById and writes via _study.properties().childs().inputs.childs()', async () => {
    let capturedExpr = '';
    const evaluate = (expr: string) => {
      capturedExpr = expr;
      return Promise.resolve({ updated_inputs: { length: 50 }, available_inputs: ['length', 'source'] });
    };

    await setInputs({ entity_id: 'x', inputs: { length: 50 }, _deps: { evaluate } });

    assert.match(capturedExpr, /getStudyById/, 'must look up study via the widget API');
    assert.match(capturedExpr, /getInputsInfo/, 'must read input metadata via the widget API');
    assert.match(
      capturedExpr,
      /_study\.properties\(\)\.childs\(\)\.inputs\.childs\(\)/,
      'must reach into the API study\'s property tree to write inputs',
    );
    assert.doesNotMatch(
      capturedExpr,
      /\.value\.setValue\(/,
      'must NOT write via node.value.setValue — that path does not trigger recompute on built-in studies',
    );
  });
});

describe('getIndicator', () => {
  it('returns inputs resolved via the property tree for built-in studies', async () => {
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

  it('throws when the study is not found', async () => {
    const evaluate = makeEvaluate(() => ({ error: 'Study not found: ghost' }));
    await assert.rejects(
      () => getIndicator({ entity_id: 'ghost', _deps: { evaluate } }),
      /Study not found/,
    );
  });
});
