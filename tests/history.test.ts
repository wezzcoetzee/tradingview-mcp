import { describe, it, expect } from 'bun:test';
import { getOhlcvPage, loadHistory } from '../src/core/history.js';
import { pageFixture } from './history-fixture.js';

describe('loaded history pages', () => {
  it('reads 1201 bars across bounded pages without duplicates and honours range bounds', async () => {
    const { deps } = pageFixture(1201);
    const times: number[] = [];
    let before: number | undefined;
    do {
      const page = await getOhlcvPage({ before, from: 60, to: 1200 * 60, _deps: deps });
      expect(page.bars.length).toBeLessThanOrEqual(500);
      times.push(...page.bars.map(b => b.time));
      before = page.next_before ?? undefined;
    } while (before !== undefined);
    expect(times.length).toBe(1200);
    expect(new Set(times).size).toBe(1200);
    expect(Math.min(...times)).toBe(60);
  });
  it('rejects invalid bounds before evaluation and reports missing bars API', async () => {
    const { deps, calls, state } = pageFixture();
    await expect(getOhlcvPage({ count: 501, _deps: deps })).rejects.toThrow('count');
    await expect(getOhlcvPage({ from: 2, to: 1, _deps: deps })).rejects.toThrow('from');
    await expect(getOhlcvPage({ before: NaN, _deps: deps })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    state.noBars = true;
    expect((await getOhlcvPage({ _deps: deps })).supported).toBe(false);
  });
});

describe('bounded history loading', () => {
  it('counts actual bars including holes, never infers completeness from endpoints', async () => {
    const { deps, rows } = pageFixture();
    rows.delete(5);
    const result = await loadHistory({ from: 0, to: 540, _deps: deps });
    expect(result.state).toBe('partial');
    expect(result.loaded.count).toBe(9);
    expect(result.range_completeness_verified).toBe(false);
    expect(result.attempts).toBe(0);
  });
  it('loads by bounded navigation and restores the original visible range', async () => {
    const { deps, state } = pageFixture();
    state.grow = true;
    const result = await loadHistory({ count: 20, poll_ms: 0, _deps: deps });
    expect(result.state).toBe('complete');
    expect(result.loaded.count).toBe(20);
    expect(result.attempts).toBe(2);
    expect(result.restoration.success).toBe(true);
    expect(state.visible).toEqual({ from: 2, to: 8 });
  });
  it('reports stalled attempts separately from true source exhaustion', async () => {
    const { deps } = pageFixture();
    const result = await loadHistory({ count: 100, poll_ms: 0, _deps: deps });
    expect(result.state).toBe('exhausted');
    expect(result.reason).toContain('source_exhaustion_unverified');
    expect(result.attempts).toBe(2);
  });
  it('honours attempt and elapsed time limits and restores after timeout', async () => {
    const { deps } = pageFixture();
    expect((await loadHistory({ count: 100, max_attempts: 1, poll_ms: 0, _deps: deps })).state).toBe('partial');
    const result = await loadHistory({ count: 100, timeout_ms: 5, poll_ms: 20, _deps: deps });
    expect(result.state).toBe('timeout');
    expect(result.restoration.success).toBe(true);
  });
  it('reports unsupported paths and restoration failures honestly', async () => {
    const { deps, state } = pageFixture();
    state.noNavigation = true;
    expect((await loadHistory({ count: 100, poll_ms: 0, _deps: deps })).state).toBe('unsupported');
    state.noNavigation = false;
    state.noBars = true;
    expect((await loadHistory({ count: 100, _deps: deps })).state).toBe('unsupported');
    state.noBars = false;
    state.grow = true;
    state.restoreFails = true;
    const result = await loadHistory({ count: 15, poll_ms: 0, _deps: deps });
    expect(result.state).toBe('complete');
    expect(result.success).toBe(false);
    expect(result.restoration.error).toBe('restore failed');
  });
  it('restores after a navigation evaluation throws and reports the interruption', async () => {
    const { deps, state } = pageFixture();
    const evaluate = deps.evaluate;
    let failed = false;
    const result = await loadHistory({ count: 100, poll_ms: 0, _deps: { evaluate: async (expression: string) => {
      if (!failed && expression.includes('ts.zoomToBarsRange')) { failed = true; throw new Error('navigation interrupted'); }
      return evaluate(expression);
    } } });
    expect(result.state).toBe('partial');
    expect(result.reason).toBe('navigation interrupted');
    expect(result.restoration.attempted).toBe(true);
    expect(state.visible).toEqual({ from: 2, to: 8 });
  });
  it('refuses navigation if the original visible range cannot be preserved', async () => {
    const { deps, calls } = pageFixture();
    const evaluate = deps.evaluate;
    const result = await loadHistory({ count: 100, _deps: { evaluate: async (expression: string) => {
      const value = await evaluate(expression);
      return expression.includes('first_index:first') ? { ...value, visible: null } : value;
    } } });
    expect(result.state).toBe('unsupported');
    expect(result.reason).toBe('cannot_preserve_visible_range');
    expect(calls.some(c => c.includes('ts.zoomToBarsRange'))).toBe(false);
  });
  it('rejects unbounded or invalid requests before touching the chart', async () => {
    const { deps, calls } = pageFixture();
    for (const params of [{}, { count: Infinity }, { count: 0 }, { count: 10, max_attempts: 51 }, { count: 10, timeout_ms: 60001 }]) {
      await expect(loadHistory({ ...params, _deps: deps })).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });
});
