/**
 * Core replay mode logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getReplayApi as _getReplayApi, requireFinite } from '../connection.js';
import { waitFor } from '../wait.js';

export const VALID_AUTOPLAY_DELAYS = [100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000];

function wv(path) {
  return `(function(){ var v = ${path}; return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; })()`;
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
  const rp = await getReplayApi();
  const available = await evaluate(wv(`${rp}.isReplayAvailable()`));
  if (!available) throw new Error('Replay is not available for the current symbol/timeframe');

  await evaluate(`${rp}.showReplayToolbar()`);

  // selectDate() is async — it calls enableReplayMode() then _onPointSelected()
  // which initializes the server-side replay session. Must be awaited inside the
  // page context, otherwise the promise is fire-and-forget and replay state says
  // "started" but stepping doesn't work (issue #26).
  if (date) {
    const parsed = new Date(date).getTime();
    if (isNaN(parsed)) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD format.`);
    const ts = requireFinite(parsed, 'replay date timestamp');
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

export async function step({ _deps }: any = {}) {
  const { evaluate, getReplayApi, waitOpts } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  const before = await evaluate(wv(`${rp}.currentDate()`));
  await evaluate(`${rp}.doStep()`);
  // doStep() is async internally, so currentDate takes ~500ms to update.
  const { ok, value } = await waitFor(wv(`${rp}.currentDate()`), (d) => d !== before, { timeout: 3000, ...waitOpts });
  if (!ok) {
    return { success: false, action: 'step', error: 'Replay date did not advance', previous_date: before, current_date: value ?? before };
  }
  return { success: true, action: 'step', current_date: value };
}

export async function autoplay({ speed, _deps }: any = {}) {
  if (speed !== undefined && !(Number.isInteger(speed) && VALID_AUTOPLAY_DELAYS.includes(speed))) {
    throw new Error(`Invalid autoplay delay ${speed}. Valid values: ${VALID_AUTOPLAY_DELAYS.join(', ')}`);
  }

  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  if (speed !== undefined) {
    await evaluate(`${rp}.changeAutoplayDelay(${speed})`);
  }
  await evaluate(`${rp}.toggleAutoplay()`);
  const isAutoplay = await evaluate(wv(`${rp}.isAutoplayStarted()`));
  const currentDelay = await evaluate(wv(`${rp}.autoplayDelay()`));
  return { success: true, autoplay_active: !!isAutoplay, delay_ms: currentDelay };
}

export async function stop({ _deps }: any = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) {
    return { success: true, action: 'already_stopped' };
  }
  await evaluate(`${rp}.stopReplay()`);
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
