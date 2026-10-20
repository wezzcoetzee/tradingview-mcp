import { describe, it, expect } from 'bun:test';
import { awaitCompile, summarizeMarkers } from '../src/core/pine.js';

const marker = (severity: number, message = 'm') => ({ line: 1, column: 1, message, severity });

describe('summarizeMarkers', () => {
  it('treats warnings and info as non-errors', () => {
    const r = summarizeMarkers([marker(4, 'unused'), marker(2, 'hint')]);
    expect(r.has_errors).toBe(false);
    expect(r.error_count).toBe(0);
    expect(r.warning_count).toBe(2);
    expect(r.warnings[0].severity).toBe(4);
  });

  it('fails only on severity 8 and keeps severity on each marker', () => {
    const r = summarizeMarkers([marker(8, 'bad'), marker(4, 'meh')]);
    expect(r.has_errors).toBe(true);
    expect(r.errors.map(e => e.message)).toEqual(['bad']);
    expect(r.errors[0].severity).toBe(8);
    expect(r.warning_count).toBe(1);
  });
});

describe('awaitCompile', () => {
  const before = { markers: [marker(8, 'old error')], studies: 1 };
  const fast = { interval: 1, timeout: 50 };

  it('keeps polling past the previous compile markers until they change', async () => {
    const snapshots = [before, before, { markers: [], studies: 1 }];
    const evaluate = async () => snapshots.shift() ?? { markers: [], studies: 1 };
    const r = await awaitCompile(before, { ...fast, evaluate });
    expect(r.confirmed).toBe(true);
    expect(r.after.markers).toEqual([]);
  });

  it('confirms on a changed study count even when markers are identical', async () => {
    const r = await awaitCompile(before, { ...fast, evaluate: async () => ({ markers: before.markers, studies: 2 }) });
    expect(r.confirmed).toBe(true);
  });

  it('reports unconfirmed instead of trusting stale markers on timeout', async () => {
    const r = await awaitCompile(before, { ...fast, evaluate: async () => before });
    expect(r.confirmed).toBe(false);
    expect(r.after).toEqual(before);
  });
});
