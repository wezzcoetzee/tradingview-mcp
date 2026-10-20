/**
 * Core replay mode logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getReplayApi as _getReplayApi, requireFinite } from '../connection.js';
import { waitFor } from '../wait.js';

export const VALID_AUTOPLAY_DELAYS = [100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000];

function wv(path) {
  return `(function(){ var v = ${path}; return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; })()`;
}

export const MAX_STEP_COUNT = 500;

/** Millisecond timestamp (UTC midnight) for a strict YYYY-MM-DD date; rejects impossible dates like 2026-02-31. */
export function parseReplayDate(date: unknown): number {
  const text = String(date);
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
  if (isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== text) {
    throw new Error(`Invalid date: "${text}". Use YYYY-MM-DD format.`);
  }
  return requireFinite(ms, 'replay date timestamp');
}

function _resolve(deps) {
  const evaluate = deps?.evaluate || _evaluate;
  return {
    evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    getReplayApi: deps?.getReplayApi || _getReplayApi,
    waitOpts: { evaluate, ...deps?.waitOpts },
  };
}

export async function start({ date, _deps }: any = {}) {
  const { evaluate, evaluateAsync, getReplayApi, waitOpts } = _resolve(_deps);
  const ts = date ? parseReplayDate(date) : null;
  const rp = await getReplayApi();
  const available = await evaluate(wv(`${rp}.isReplayAvailable()`));
  if (!available) throw new Error('Replay is not available for the current symbol/timeframe');

  await evaluate(`${rp}.showReplayToolbar()`);

  // selectDate() is async — it calls enableReplayMode() then _onPointSelected()
  // which initializes the server-side replay session. Must be awaited inside the
  // page context, otherwise the promise is fire-and-forget and replay state says
  // "started" but stepping doesn't work (issue #26).
  if (ts !== null) {
    await evaluateAsync(`${rp}.selectDate(${ts}).then(function() { return 'ok'; })`);
  } else {
    await evaluateAsync(`Promise.resolve(${rp}.selectFirstAvailableDate()).then(function() { return 'ok'; })`);
  }

  // Poll until replay is fully initialized: isReplayStarted AND currentDate is set.
  // selectDate()'s promise resolves before the data series is ready, so we need
  // to wait for currentDate to become non-null before stepping will work.
  let started = false;
  let currentDate = null;
  for (let i = 0; i < 30; i++) {
    started = await evaluate(wv(`${rp}.isReplayStarted()`));
    currentDate = await evaluate(wv(`${rp}.currentDate()`));
    if (started && currentDate !== null) break;
    await new Promise(r => setTimeout(r, waitOpts.interval ?? 250));
  }

  if (!started || currentDate === null || currentDate === undefined) {
    try { await evaluate(`${rp}.stopReplay()`); } catch {}
    throw new Error('Replay failed to start (no current date). The selected date may not have data for this timeframe. Try a more recent date or a higher timeframe (e.g., Daily).');
  }

  return { success: true, replay_started: true, date: date || '(first available)', current_date: currentDate };
}

export async function step({ count = 1, _deps }: { count?: number; _deps?: unknown } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_STEP_COUNT) {
    throw new Error(`Invalid step count ${count}. Use an integer from 1 to ${MAX_STEP_COUNT}.`);
  }
  const { evaluate, getReplayApi, waitOpts } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');

  let current = await evaluate(wv(`${rp}.currentDate()`));
  let advanced = 0;
  while (advanced < count) {
    const before = current;
    await evaluate(`${rp}.doStep()`);
    // doStep() is async internally, so currentDate takes ~500ms to update.
    const { ok, value } = await waitFor(wv(`${rp}.currentDate()`), (d) => d !== before, { timeout: 3000, ...waitOpts });
    if (!ok) {
      return { success: false, action: 'step', error: 'Replay date did not advance', requested: count, advanced, previous_date: before, current_date: value ?? before };
    }
    current = value;
    advanced++;
  }
  return { success: true, action: 'step', requested: count, advanced, current_date: current };
}

export async function jump({ date, _deps }: { date?: string; _deps?: unknown } = {}) {
  const ts = parseReplayDate(date);
  const { evaluate, evaluateAsync, getReplayApi, waitOpts } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');

  const before = await evaluate(wv(`${rp}.currentDate()`));
  await evaluateAsync(`${rp}.selectDate(${ts}).then(function() { return 'ok'; })`);
  const { ok, value } = await waitFor(wv(`${rp}.currentDate()`), (d) => d !== before, { timeout: 5000, ...waitOpts });
  // Jumping to the day the replay is already on leaves the date unchanged.
  if (!ok && typeof before === 'number' && Math.floor(before / 86400) === Math.floor(ts / 86400000)) {
    return { success: true, action: 'jump', date, previous_date: before, current_date: before, unchanged: true };
  }
  if (!ok) {
    return { success: false, action: 'jump', error: 'Replay date did not change', date, previous_date: before, current_date: value ?? before };
  }
  return { success: true, action: 'jump', date, previous_date: before, current_date: value };
}

export async function autoplay({ speed, enabled, _deps }: { speed?: number; enabled?: boolean; _deps?: unknown } = {}) {
  if (speed !== undefined && !(Number.isInteger(speed) && VALID_AUTOPLAY_DELAYS.includes(speed))) {
    throw new Error(`Invalid autoplay delay ${speed}. Valid values: ${VALID_AUTOPLAY_DELAYS.join(', ')}`);
  }

  const { evaluate, getReplayApi, waitOpts } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  if (speed !== undefined) {
    await evaluate(`${rp}.changeAutoplayDelay(${speed})`);
  }
  // `enabled` sets an explicit state; without it autoplay flips.
  const was = !!(await evaluate(wv(`${rp}.isAutoplayStarted()`)));
  const target = enabled ?? !was;
  if (target !== was) await evaluate(`${rp}.toggleAutoplay()`);
  const { ok, value } = await waitFor<boolean>(wv(`!!${rp}.isAutoplayStarted()`), (on) => on === target, { timeout: 3000, ...waitOpts });
  const delay = await evaluate(wv(`${rp}.autoplayDelay()`));
  if (!ok) {
    return { success: false, error: `Autoplay did not turn ${target ? 'on' : 'off'}`, autoplay_active: !!value, delay_ms: delay };
  }
  return { success: true, autoplay_active: target, delay_ms: delay };
}

export async function stop({ _deps }: any = {}) {
  const { evaluate, getReplayApi, waitOpts } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) {
    return { success: true, action: 'already_stopped' };
  }
  await evaluate(`${rp}.stopReplay()`);
  const { ok } = await waitFor<boolean>(wv(`!!${rp}.isReplayStarted()`), (on) => !on, { timeout: 3000, ...waitOpts });
  if (!ok) return { success: false, action: 'stop', error: 'Replay is still running after stopReplay' };
  return { success: true, action: 'replay_stopped' };
}

export async function trade({ action, _deps }: any = {}) {
  const { evaluate, getReplayApi, waitOpts } = _resolve(_deps);
  if (!['buy', 'sell', 'close'].includes(action)) throw new Error('Invalid action. Use: buy, sell, or close');
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');

  const readPosition = `
    (function() {
      var r = ${rp};
      function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
      return { position: unwrap(r.position()), realized_pnl: unwrap(r.realizedPL()) };
    })()
  `;
  const before = await evaluate(readPosition);

  if (action === 'buy') await evaluate(`${rp}.buy()`);
  else if (action === 'sell') await evaluate(`${rp}.sell()`);
  else await evaluate(`${rp}.closePosition()`);

  // Orders fill asynchronously: wait for the position to move (or go flat for close).
  const { ok, value } = await waitFor<{ position: unknown; realized_pnl: unknown }>(
    readPosition,
    (now) => action === 'close' ? !now.position : JSON.stringify(now.position) !== JSON.stringify(before?.position),
    { timeout: 3000, ...waitOpts },
  );
  if (!ok) {
    return { success: false, action, error: `Position did not settle after ${action}`, position: value?.position ?? before?.position, realized_pnl: value?.realized_pnl ?? before?.realized_pnl };
  }
  return { success: true, action, position: value.position, realized_pnl: value.realized_pnl };
}

export async function status({ _deps }: any = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const st = await evaluate(`
    (function() {
      var r = ${rp};
      function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
      return {
        is_replay_available: unwrap(r.isReplayAvailable()),
        is_replay_started: unwrap(r.isReplayStarted()),
        is_autoplay_started: unwrap(r.isAutoplayStarted()),
        replay_mode: unwrap(r.replayMode()),
        current_date: unwrap(r.currentDate()),
        autoplay_delay: unwrap(r.autoplayDelay()),
        position: unwrap(r.position()),
        realized_pnl: unwrap(r.realizedPL()),
      };
    })()
  `);
  return { success: true, ...st };
}
