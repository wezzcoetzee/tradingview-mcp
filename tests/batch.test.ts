import { describe, it, expect } from 'bun:test';
import { batchRun } from '../src/core/batch.js';
import { pageFixture } from './history-fixture.js';

describe('batch collections', () => {
  it('executes all new collections against page models, filters and bounds output, labels observations and restores', async () => {
    for (const action of ['get_study_values', 'get_pine_lines', 'get_pine_labels', 'get_pine_tables', 'get_pine_boxes', 'collect_analysis'] as const) {
      const { deps, state } = pageFixture();
      const result = await batchRun({ symbols: ['EX:AAPL', 'EX:MSFT'], timeframes: ['D', '60'], action, study_filter: 'ALPHA', max_items: 1, delay_ms: 0, _deps: deps });
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(4);
      expect(result.restoration.range).toBe('restored');
      expect(state.symbol).toBe('EX:ORIGINAL');
      expect(state.timeframe).toBe('60');
      expect(state.visible).toEqual({ from: 2, to: 8 });
      for (const observation of result.results) {
        expect(observation.captured_at).toMatch(/^\d{4}-/);
        expect(observation.timeframe).toMatch(/^(D|60)$/);
        const json = JSON.stringify(observation);
        expect(json).toContain('Alpha');
        expect(json).not.toContain('Beta');
        expect(json.length).toBeLessThan(15000);
      }
    }
  });
  it('rejects symbol mismatches even when readiness incorrectly succeeds', async () => {
    const { deps, state } = pageFixture();
    state.switchesFail = true;
    const result = await batchRun({ symbols: ['AAPL'], action: 'get_study_values', delay_ms: 0, _deps: deps });
    expect(result.failed).toBe(1);
    expect(JSON.stringify(result.results)).toContain('identity changed');
  });
  it('rejects a matching ticker on the wrong exchange', async () => {
    const { deps, state } = pageFixture();
    state.symbol = 'OTHER:AAPL';
    state.switchesFail = true;
    const result = await batchRun({ symbols: ['NASDAQ:AAPL'], action: 'get_study_values', delay_ms: 0, _deps: deps });
    expect(result.failed).toBe(1);
  });
  it('rejects identity changes during capture', async () => {
    const { deps, state } = pageFixture();
    state.changedDuringRead = true;
    const result = await batchRun({ symbols: ['AAPL'], action: 'get_study_values', delay_ms: 0, _deps: deps });
    expect(result.failed).toBe(1);
    expect(JSON.stringify(result.results)).toContain('during capture');
  });
  it('reports symbol/timeframe and range restoration failures', async () => {
    const { deps, state } = pageFixture();
    state.restoreFails = true;
    const result = await batchRun({ symbols: ['AAPL'], action: 'get_pine_lines', delay_ms: 0, _deps: deps });
    expect(result.success).toBe(false);
    expect(result.restoration.error).toBe('restore failed');
    expect(result.restoration.range).toBe('failed');
    state.restoreFails = false;
    let waits = 0;
    deps.waitForChartReady = async () => ({ ok: ++waits === 1, value: undefined });
    const failed = await batchRun({ symbols: ['AAPL'], action: 'get_pine_boxes', delay_ms: 0, _deps: deps });
    expect(failed.restoration.symbol_timeframe).toBe(false);
  });
  it('fails safely when switching APIs or original state are unavailable', async () => {
    const { deps } = pageFixture();
    const missing = { ...deps, getChartCollection: async () => { throw new Error('missing'); }, getChartApi: async () => { throw new Error('missing'); } };
    const result = await batchRun({ symbols: ['AAPL'], action: 'get_pine_lines', delay_ms: 0, _deps: missing });
    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    await expect(batchRun({ symbols: ['AAPL'], action: 'get_pine_lines', _deps: { ...deps, evaluate: async () => null } })).rejects.toThrow('preserve');
  });
  it('rejects excessive iterations and counts before evaluation', async () => {
    const { deps, calls } = pageFixture();
    await expect(batchRun({ symbols: Array(101).fill('AAPL'), action: 'get_pine_lines', _deps: deps })).rejects.toThrow('100');
    await expect(batchRun({ symbols: ['AAPL'], action: 'get_pine_lines', max_items: 51, _deps: deps })).rejects.toThrow('max_items');
    expect(calls).toHaveLength(0);
  });
});
