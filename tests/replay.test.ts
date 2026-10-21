/**
 * Tests for all replay functions in src/core/replay.js.
 * Covers: start, step, autoplay, stop, trade, status + DI mocks.
 */
import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { start, step, jump, autoplay, stop, trade, status, parseReplayDate, VALID_AUTOPLAY_DELAYS, MAX_STEP_COUNT } from '../src/core/replay.js';

// ── Mock helpers ─────────────────────────────────────────────────────────

/**
 * Create a mock evaluate function that returns scripted values.
 * Calls are tracked in .calls array.
 * @param {object} responses — map of substring→return value. First matching key wins.
 * @param {Array} [sequence] — if provided, override responses with sequential returns
 */
function mockEvaluate(responses: any = {}, sequence?: any) {
  let callIdx = 0;
  const calls: string[] = [];
  const fn = async (expr: string) => {
    calls.push(expr);
    if (sequence && callIdx < sequence.length) return sequence[callIdx++];
    for (const [key, val] of Object.entries(responses)) {
      if (expr.includes(key)) return typeof val === 'function' ? val(callIdx++) : val;
    }
    return undefined;
  };
  fn.calls = calls;
  return fn;
}

const FAST = { timeout: 100, interval: 10 };

function mockGetReplayApi() {
  return async () => 'window.__rp';
}

function mockDeps(responses: any = {}, sequence?: any) {
  const evaluate = mockEvaluate(responses, sequence);
  return { _deps: { evaluate, evaluateAsync: evaluate, getReplayApi: mockGetReplayApi(), waitOpts: FAST }, evaluate };
}

/** Replay page whose toggles and steps take effect, so verification can pass. */
function livePage({ started = true, autoplayOn = false, date = 1000, stepsMove = true, stops = true, jumpTo = 5000 } = {}) {
  const state = { started, autoplayOn, date, delay: 1000, stepCalls: 0 };
  const evaluate = async (expr: string) => {
    if (expr.includes('doStep')) { state.stepCalls++; if (stepsMove) state.date += 1; return undefined; }
    if (expr.includes('toggleAutoplay')) { state.autoplayOn = !state.autoplayOn; return undefined; }
    if (expr.includes('changeAutoplayDelay')) { state.delay = Number(/\((\d+)\)/.exec(expr)![1]); return undefined; }
    if (expr.includes('stopReplay')) { if (stops) state.started = false; return undefined; }
    if (expr.includes('selectDate')) { state.date = jumpTo; return 'ok'; }
    if (expr.includes('isReplayStarted')) return state.started;
    if (expr.includes('isAutoplayStarted')) return state.autoplayOn;
    if (expr.includes('autoplayDelay')) return state.delay;
    if (expr.includes('currentDate')) return state.date;
    return undefined;
  };
  return { state, _deps: { evaluate, evaluateAsync: evaluate, getReplayApi: mockGetReplayApi(), waitOpts: FAST } };
}

// ── start() ──────────────────────────────────────────────────────────────

describe('start() — date selection and polling', () => {
  it('awaits selectDate with timestamp in ms for date param', async () => {
    const { _deps, evaluate } = mockDeps({
      'isReplayAvailable': true,
      'showReplayToolbar': undefined,
      'selectDate': 'ok',
      'isReplayStarted': true,
      'currentDate': 1773532799,
    });
    const result = await start({ date: '2026-03-15', _deps });
    assert.equal(result.success, true);
    assert.equal(result.replay_started, true);
    assert.equal(result.current_date, 1773532799);
    assert.equal(result.date, '2026-03-15');
    // Verify selectDate was called with timestamp and .then()
    const selectCall = evaluate.calls.find(c => c.includes('selectDate'));
    assert.ok(selectCall, 'selectDate was called');
    assert.ok(selectCall.includes('.then('), 'promise is awaited via .then()');
    assert.ok(selectCall.includes('1773532800000') || selectCall.includes('177'), 'passes ms timestamp');
  });

  it('calls selectFirstAvailableDate when no date given', async () => {
    const { _deps, evaluate } = mockDeps({
      'isReplayAvailable': true,
      'showReplayToolbar': undefined,
      'selectFirstAvailableDate': undefined,
      'isReplayStarted': true,
      'currentDate': 946684800,
    });
    const result = await start({ _deps });
    assert.equal(result.date, '(first available)');
    const firstAvail = evaluate.calls.find(c => c.includes('selectFirstAvailableDate'));
    assert.ok(firstAvail, 'selectFirstAvailableDate was called');
  });

  it('rejects an invalid date before any page call', async () => {
    for (const bad of ['not-a-date', '2026-02-31', '2026-3-5', '2026-03-15T10:00', '03/15/2026']) {
      const { _deps, evaluate } = mockDeps({ 'isReplayAvailable': true });
      await assert.rejects(() => start({ date: bad, _deps }), /Invalid date/);
      assert.equal(evaluate.calls.length, 0, `no page calls for "${bad}"`);
    }
  });

  it('throws when replay not available', async () => {
    const { _deps } = mockDeps({ 'isReplayAvailable': false });
    await assert.rejects(
      () => start({ date: '2026-01-01', _deps }),
      (err: any) => err.message.includes('not available'),
    );
  });

  it('polls until isReplayStarted AND currentDate are set', async () => {
    let pollCount = 0;
    const evaluate = async (expr: string) => {
      if (expr.includes('isReplayAvailable')) return true;
      if (expr.includes('showReplayToolbar') || expr.includes('selectDate')) return 'ok';
      if (expr.includes('isReplayStarted')) {
        pollCount++;
        return pollCount >= 3; // becomes true on 3rd poll
      }
      if (expr.includes('currentDate')) {
        return pollCount >= 4 ? 1700000000 : null; // non-null on 4th poll
      }
      return undefined;
    };
    evaluate.calls = [] as string[];
    const result = await start({ date: '2026-01-01', _deps: { evaluate, evaluateAsync: evaluate, getReplayApi: mockGetReplayApi(), waitOpts: FAST } });
    assert.equal(result.success, true);
    assert.equal(result.current_date, 1700000000);
    assert.ok(pollCount >= 4, 'polled multiple times');
  });

  it('throws and stops replay when polling times out (never started)', async () => {
    let stopCalled = false;
    const evaluate = async (expr: string) => {
      if (expr.includes('isReplayAvailable')) return true;
      if (expr.includes('showReplayToolbar') || expr.includes('selectDate')) return 'ok';
      if (expr.includes('isReplayStarted')) return false; // never starts
      if (expr.includes('currentDate')) return null;
      if (expr.includes('stopReplay')) { stopCalled = true; return undefined; }
      return undefined;
    };
    evaluate.calls = [] as string[];
    await assert.rejects(
      () => start({ date: '2026-01-01', _deps: { evaluate, evaluateAsync: evaluate, getReplayApi: mockGetReplayApi(), waitOpts: FAST } }),
      (err) => {
        assert.ok((err as any).message.includes('Replay failed to start'));
        return true;
      },
    );
    assert.ok(stopCalled, 'stopReplay called for cleanup');
  });

  it('fails when replay started but no current date ever arrives', async () => {
    const { _deps } = mockDeps({
      'isReplayAvailable': true, 'showReplayToolbar': undefined, 'selectDate': 'ok',
      'isReplayStarted': true, 'currentDate': null, 'stopReplay': undefined,
    });
    await assert.rejects(() => start({ date: '2026-01-01', _deps }), /no current date/);
  });
});

// ── step() ───────────────────────────────────────────────────────────────

describe('step() — doStep and polling', () => {
  it('advances one bar by default', async () => {
    const { _deps, state } = livePage();
    const result = await step({ _deps });
    assert.equal(result.success, true);
    assert.equal(result.action, 'step');
    assert.equal(result.advanced, 1);
    assert.equal(result.current_date, 1001);
    assert.equal(state.stepCalls, 1);
  });

  it('advances count bars and reports advanced', async () => {
    const { _deps, state } = livePage();
    const result = await step({ count: 5, _deps });
    assert.equal(result.success, true);
    assert.equal(result.advanced, 5);
    assert.equal(result.current_date, 1005);
    assert.equal(state.stepCalls, 5);
  });

  it('fails if the date never advances', async () => {
    const { _deps } = livePage({ stepsMove: false });
    const result = await step({ count: 3, _deps });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /did not advance/);
    assert.equal(result.advanced, 0);
    assert.equal(result.current_date, 1000);
  });

  it('rejects counts outside 1..max before any page call', async () => {
    for (const count of [0, -1, 1.5, MAX_STEP_COUNT + 1]) {
      const { _deps, evaluate } = mockDeps({});
      await assert.rejects(() => step({ count, _deps }), /Invalid step count/);
      assert.equal(evaluate.calls.length, 0);
    }
  });

  it('throws when replay not started', async () => {
    const { _deps } = mockDeps({ 'isReplayStarted': false });
    await assert.rejects(
      () => step({ _deps }),
      (err: any) => err.message.includes('not started'),
    );
  });
});

// ── jump() ───────────────────────────────────────────────────────────────

describe('jump()', () => {
  it('selects the date while replay runs and reports the new position', async () => {
    const { _deps } = livePage();
    const result = await jump({ date: '2026-03-15', _deps });
    assert.equal(result.success, true);
    assert.equal(result.previous_date, 1000);
    assert.equal(result.current_date, 5000);
  });

  it('fails when the replay date does not change to another day', async () => {
    const { _deps, state } = livePage({ date: 5000, jumpTo: 5000 });
    const result = await jump({ date: '2026-03-15', _deps });
    assert.equal(result.success, false);
    assert.equal(state.date, 5000);
  });

  it('succeeds when the replay is already on the requested day', async () => {
    const sameDay = Date.UTC(2026, 2, 15, 13) / 1000;
    const { _deps } = livePage({ date: sameDay, jumpTo: sameDay });
    const result = await jump({ date: '2026-03-15', _deps });
    assert.equal(result.success, true);
    assert.equal(result.unchanged, true);
    assert.equal(result.current_date, sameDay);
  });

  it('rejects a bad date before any page call', async () => {
    const { _deps, evaluate } = mockDeps({});
    await assert.rejects(() => jump({ date: '2026-13-01', _deps }), /Invalid date/);
    assert.equal(evaluate.calls.length, 0);
  });

  it('throws when replay not started', async () => {
    const { _deps } = livePage({ started: false });
    await assert.rejects(() => jump({ date: '2026-03-15', _deps }), /not started/);
  });
});

describe('parseReplayDate()', () => {
  it('returns UTC midnight in ms', () => {
    assert.equal(parseReplayDate('2026-03-15'), Date.UTC(2026, 2, 15));
  });
  it('rejects non YYYY-MM-DD and impossible dates', () => {
    for (const bad of ['', 'abc', '2026-02-30', '2026-3-15', '2026-03-15 ', '20260315']) {
      assert.throws(() => parseReplayDate(bad), /Invalid date/, bad);
    }
  });
});

// ── autoplay() ───────────────────────────────────────────────────────────

describe('autoplay() — delay validation', () => {
  for (const delay of VALID_AUTOPLAY_DELAYS) {
    it(`accepts valid delay ${delay}ms`, async () => {
      const { _deps } = livePage();
      const result = await autoplay({ speed: delay, _deps });
      assert.equal(result.success, true);
      assert.equal(result.autoplay_active, true);
      assert.equal(result.delay_ms, delay);
    });
  }

  const INVALID_DELAYS = [0, 50, 60000, 99, 101, 500, 750, 1500, 9999, 20000];
  for (const delay of INVALID_DELAYS) {
    it(`rejects invalid delay ${delay}ms before any CDP call`, async () => {
      const { _deps, evaluate } = mockDeps({});
      await assert.rejects(
        () => autoplay({ speed: delay, _deps }),
        (err) => {
          assert.ok((err as any).message.includes('Invalid autoplay delay'));
          assert.ok((err as any).message.includes(String(delay)));
          return true;
        },
      );
      // No CDP calls should have been made
      assert.equal(evaluate.calls.length, 0, 'no CDP calls for invalid speed');
    });
  }

  it('flips autoplay without changing speed when enabled and speed are omitted', async () => {
    const { _deps, state } = livePage({ autoplayOn: true });
    const result = await autoplay({ _deps });
    assert.equal(result.autoplay_active, false);
    assert.equal(state.delay, 1000, 'speed untouched');
  });

  it('enabled sets an explicit state and never toggles when already there', async () => {
    const on = livePage({ autoplayOn: true });
    assert.equal((await autoplay({ enabled: true, _deps: on._deps })).autoplay_active, true);
    assert.equal(on.state.autoplayOn, true, 'a second enabled:true must not stop autoplay');
    const off = livePage({ autoplayOn: true });
    assert.equal((await autoplay({ enabled: false, _deps: off._deps })).autoplay_active, false);
    assert.equal(off.state.autoplayOn, false);
  });

  it('fails when autoplay does not reach the requested state', async () => {
    const evaluate = async (expr: string) => {
      if (expr.includes('isReplayStarted')) return true;
      if (expr.includes('isAutoplayStarted')) return false;
      return undefined;
    };
    const result = await autoplay({ enabled: true, _deps: { evaluate, evaluateAsync: evaluate, getReplayApi: mockGetReplayApi(), waitOpts: FAST } });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /did not turn on/);
  });

  it('throws when replay not started', async () => {
    const { _deps } = mockDeps({ 'isReplayStarted': false });
    await assert.rejects(
      () => autoplay({ speed: 1000, _deps }),
      (err: any) => err.message.includes('not started'),
    );
  });
});

// ── stop() ───────────────────────────────────────────────────────────────

describe('stop()', () => {
  it('calls stopReplay and confirms replay ended', async () => {
    const { _deps, state } = livePage();
    const result = await stop({ _deps });
    assert.equal(result.success, true);
    assert.equal(result.action, 'replay_stopped');
    assert.equal(state.started, false);
  });

  it('fails when replay is still running after stopReplay', async () => {
    const { _deps } = livePage({ stops: false });
    const result = await stop({ _deps });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /still running/);
  });

  it('returns already_stopped when not started', async () => {
    const { _deps, evaluate } = mockDeps({ 'isReplayStarted': false });
    const result = await stop({ _deps });
    assert.equal(result.action, 'already_stopped');
    const stopCall = evaluate.calls.find(c => c.includes('stopReplay'));
    assert.equal(stopCall, undefined, 'stopReplay not called');
  });

  it('does not call hideReplayToolbar', () => {
    const source = readFileSync(new URL('../src/core/replay.ts', import.meta.url), 'utf8');
    assert.ok(!source.includes('hideReplayToolbar'), 'hideReplayToolbar must not appear anywhere');
  });
});

// ── trade() ──────────────────────────────────────────────────────────────

describe('trade()', () => {
  // position() is 0 until the order fills; close flips it back to 0.
  function fillingDeps(startPosition: number, filledPosition: number) {
    let ordered = false;
    const evaluate = async (expr: string) => {
      if (expr.includes('isReplayStarted')) return true;
      if (/\.(buy|sell|closePosition)\(\)/.test(expr)) { ordered = true; return undefined; }
      if (expr.includes('realizedPL')) return { position: ordered ? filledPosition : startPosition, realized_pnl: 50.5 };
      return undefined;
    };
    return { evaluate, getReplayApi: mockGetReplayApi(), waitOpts: FAST };
  }

  for (const [action, from, to] of [['buy', 0, 1], ['sell', 0, -1], ['close', 1, 0]] as const) {
    it(`executes ${action} action and waits for the position to settle`, async () => {
      const result = await trade({ action, _deps: fillingDeps(from, to) });
      assert.equal(result.success, true);
      assert.equal(result.action, action);
      assert.equal(result.position, to);
      assert.equal(result.realized_pnl, 50.5);
    });
  }

  it('fails when the position never changes after an order', async () => {
    const result = await trade({ action: 'buy', _deps: fillingDeps(0, 0) });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /did not settle/);
  });

  it('throws on invalid action', async () => {
    const { _deps } = mockDeps({ 'isReplayStarted': true });
    await assert.rejects(
      () => trade({ action: 'hold' as unknown as 'buy', _deps }),
      (err: any) => err.message.includes('Invalid action'),
    );
  });

  it('throws when replay not started', async () => {
    const { _deps } = mockDeps({ 'isReplayStarted': false });
    await assert.rejects(
      () => trade({ action: 'buy', _deps }),
      (err: any) => err.message.includes('not started'),
    );
  });
});

// ── status() ─────────────────────────────────────────────────────────────

describe('status()', () => {
  it('returns full status object', async () => {
    const calls: string[] = [];
    const evaluate = async (expr: string) => {
      calls.push(expr);
      return {
        is_replay_available: true,
        is_replay_started: true,
        is_autoplay_started: false,
        replay_mode: 'ActiveChart',
        current_date: 1700000000,
        autoplay_delay: 1000,
        position: 2,
        realized_pnl: 123.45,
      };
    };
    evaluate.calls = calls;
    const result = await status({ _deps: { evaluate, evaluateAsync: evaluate, getReplayApi: mockGetReplayApi(), waitOpts: FAST } });
    assert.equal(result.success, true);
    assert.equal(result.is_replay_started, true);
    assert.equal(result.current_date, 1700000000);
    assert.equal(result.position, 2);
    assert.equal(result.realized_pnl, 123.45);
    assert.equal(calls.length, 1, 'status reads should be folded into a single evaluate');
  });
});
