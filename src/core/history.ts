import { evaluate as defaultEvaluate, requireFinite } from '../connection.js';
import { CHART_API, sleep, type WithDeps } from './_page.js';
import { errorMessage } from '../debug.js';

export function bounded(value: number | undefined, fallback: number, max: number, name: string, min = 1) {
  const n = value === undefined ? fallback : requireFinite(value, name);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function range(from?: number, to?: number) {
  if (from !== undefined) requireFinite(from, 'from');
  if (to !== undefined) requireFinite(to, 'to');
  if (from !== undefined && to !== undefined && from > to) throw new Error('from must not be after to');
}

export interface HistoryPageParams extends WithDeps {
  from?: number;
  to?: number;
  before?: number;
  count?: number;
}

export async function getOhlcvPage({ from, to, before, count, _deps }: HistoryPageParams = {}) {
  range(from, to);
  if (before !== undefined) requireFinite(before, 'before');
  const limit = bounded(count, 500, 500, 'count');
  const evaluate = _deps?.evaluate ?? defaultEvaluate;
  const data: { supported: boolean; symbol?: string; timeframe?: string; bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[]; has_more?: boolean } = await evaluate(`(function() { try {
    var chart = ${CHART_API};
    var bars = chart._chartWidget.model().mainSeries().bars();
    if (!bars || typeof bars.valueAt !== 'function' || typeof bars.firstIndex !== 'function' || typeof bars.lastIndex !== 'function') return { supported: false, bars: [] };
    var result = [];
    for (var i = bars.lastIndex(); i >= bars.firstIndex(); i--) {
      var v = bars.valueAt(i);
      if (!v || v[0] > ${to ?? 'Infinity'} || v[0] >= ${before ?? 'Infinity'}) continue;
      if (v[0] < ${from ?? '-Infinity'}) break;
      result.push({time:v[0],open:v[1],high:v[2],low:v[3],close:v[4],volume:v[5] || 0});
      if (result.length > ${limit}) break;
    }
    var more = result.length > ${limit};
    if (more) result.pop();
    result.reverse();
    return { supported:true, symbol:chart.symbol(), timeframe:chart.resolution(), bars:result, has_more:more };
    } catch (e) { return {supported:false,bars:[]}; }
  })()`);
  return { success: data.supported, ...data, captured_at: new Date().toISOString(), next_before: data.has_more ? data.bars[0]?.time : null,
    consistency: 'Live loaded bars; pages are not an immutable snapshot. Keep symbol and timeframe fixed.' };
}

export interface LoadHistoryParams extends WithDeps {
  from?: number;
  to?: number;
  count?: number;
  max_attempts?: number;
  timeout_ms?: number;
  poll_ms?: number;
}

interface Coverage {
  supported: boolean;
  symbol?: string;
  timeframe?: string;
  from: number | null;
  to: number | null;
  count: number;
  first_index?: number;
  visible?: { from: number; to: number } | null;
}

export async function loadHistory({ from, to, count, max_attempts, timeout_ms, poll_ms, _deps }: LoadHistoryParams = {}) {
  range(from, to);
  const requestedCount = count === undefined ? undefined : bounded(count, 100, 100000, 'count');
  if (from === undefined && to === undefined && requestedCount === undefined) throw new Error('Request from, to and/or count');
  const max = bounded(max_attempts, 5, 50, 'max_attempts');
  const budget = bounded(timeout_ms, 10000, 60000, 'timeout_ms');
  const poll = bounded(poll_ms, 250, 2000, 'poll_ms', 0);
  const rawEvaluate = _deps?.evaluate ?? defaultEvaluate;
  const started = Date.now();
  const evaluate = (expression: string, restoring = false) => rawEvaluate(expression, { timeoutMs: restoring ? 3000 : Math.max(1, budget - (Date.now() - started)) });
  const read = async (): Promise<Coverage> => evaluate(`(function() { try {
    var chart = ${CHART_API};
    var bars = chart._chartWidget.model().mainSeries().bars();
    if (!bars || typeof bars.firstIndex !== 'function' || typeof bars.lastIndex !== 'function' || typeof bars.valueAt !== 'function') return {supported:false,from:null,to:null,count:0};
    var first = bars.firstIndex(), last = bars.lastIndex(), a = bars.valueAt(first), b = bars.valueAt(last), count = 0;
    for (var i = first; i <= last; i++) { var v = bars.valueAt(i); if (v && v[0] >= ${from ?? '-Infinity'} && v[0] <= ${to ?? 'Infinity'}) count++; }
    return { supported:true,symbol:chart.symbol(),timeframe:chart.resolution(),from:a ? a[0] : null,to:b ? b[0] : null,count:count,first_index:first,visible:typeof chart.getVisibleBarsRange === 'function' ? chart.getVisibleBarsRange() : null };
    } catch (e) { return {supported:false,from:null,to:null,count:0}; }
  })()`);
  let readError: string | undefined;
  let loaded = await read().catch((err): Coverage => { readError = errorMessage(err); return { supported: false, from: null, to: null, count: 0 }; });
  const original = loaded;
  let attempts = 0;
  let stalls = 0;
  let state: 'complete' | 'partial' | 'exhausted' | 'timeout' | 'unsupported' = 'partial';
  let reason = 'attempt_limit';
  let moved = false;
  let restoration: { success: boolean; error?: string; attempted: boolean } = { success: true, attempted: false };
  try {
    while (true) {
      if (readError) { state = Date.now() - started >= budget ? 'timeout' : 'partial'; reason = readError; break; }
      if (!loaded.supported) { state = 'unsupported'; reason = 'bars_api_unavailable'; break; }
      if (loaded.symbol !== original.symbol || loaded.timeframe !== original.timeframe) { state = 'partial'; reason = 'chart_changed'; break; }
      const edges = (from === undefined || (loaded.from !== null && loaded.from <= from)) && (to === undefined || (loaded.to !== null && loaded.to >= to));
      if (edges && (requestedCount === undefined || loaded.count >= requestedCount)) {
        state = from === undefined && to === undefined ? 'complete' : 'partial';
        reason = state === 'complete' ? 'requested_count_loaded' : 'range_endpoints_reached_completeness_unverified';
        break;
      }
      if (Date.now() - started >= budget) { state = 'timeout'; reason = 'time_budget'; break; }
      if (attempts >= max) break;
      if (!original.visible || !Number.isFinite(original.visible.from) || !Number.isFinite(original.visible.to)) { state = 'unsupported'; reason = 'cannot_preserve_visible_range'; break; }
      // Only the existing model navigation mechanism is used. Its ability to trigger loading varies by build.
      const previouslyMoved = moved;
      moved = true;
      const navigated: boolean = await evaluate(`(function() {
        var ts = ${CHART_API}._chartWidget.model().timeScale();
        if (!ts || typeof ts.zoomToBarsRange !== 'function') return false;
        ts.zoomToBarsRange(${(loaded.first_index ?? 0) - 500 * (attempts + 1)}, ${(loaded.first_index ?? 0) + 10}); return true;
      })()`);
      if (!navigated) { moved = previouslyMoved; state = 'unsupported'; reason = 'navigation_api_unavailable'; break; }
      attempts++;
      await sleep(Math.min(poll, Math.max(0, budget - (Date.now() - started))));
      const next = await read();
      const stalled = next.count === loaded.count && next.from === loaded.from && next.to === loaded.to;
      loaded = next;
      if (Date.now() - started >= budget) { state = 'timeout'; reason = 'time_budget'; break; }
      stalls = stalled ? stalls + 1 : 0;
      if (stalls >= 2) { state = 'exhausted'; reason = 'attempts_stalled_source_exhaustion_unverified'; break; }
    }
  } catch (err) {
    state = Date.now() - started >= budget ? 'timeout' : 'partial';
    reason = errorMessage(err);
  } finally {
    if (moved && original.visible) {
      restoration = { success: false, attempted: true };
      try {
        const restored: boolean = await evaluate(`(function() {
          var chart = ${CHART_API};
          if (chart.symbol() !== ${JSON.stringify(original.symbol)} || chart.resolution() !== ${JSON.stringify(original.timeframe)}) return false;
          chart._chartWidget.model().timeScale().zoomToBarsRange(${original.visible.from}, ${original.visible.to});
          var r = chart.getVisibleBarsRange();
          return !!r && Math.abs(r.from - ${original.visible.from}) < 1 && Math.abs(r.to - ${original.visible.to}) < 1;
        })()`, true);
        restoration.success = restored;
        if (!restored) restoration.error = 'Original visible range did not settle or chart changed';
      } catch (err) { restoration.error = errorMessage(err); }
    }
  }
  return { success: state === 'complete' && restoration.success, state, reason, attempts, elapsed_ms: Date.now() - started,
    requested: { from: from ?? null, to: to ?? null, count: requestedCount ?? null }, loaded,
    range_completeness_verified: false, restoration, captured_at: new Date().toISOString() };
}
