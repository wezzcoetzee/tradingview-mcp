/**
 * Core chart control logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, safeString, requireFinite } from '../connection.js';
import { waitFor, waitForChartReady as _waitForChartReady } from '../wait.js';
import { parseJsonObject } from './json.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    waitForChartReady: deps?.waitForChartReady || _waitForChartReady,
    waitOpts: { evaluate: deps?.evaluate || _evaluate, ...deps?.waitOpts },
  };
}

export async function getState({ _deps }: any = {}) {
  const { evaluate } = _resolve(_deps);
  const state = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var studies = [];
      try {
        var allStudies = chart.getAllStudies();
        studies = allStudies.map(function(s) {
          return { id: s.id, name: s.name || s.title || 'unknown' };
        });
      } catch(e) {}
      return {
        symbol: chart.symbol(),
        resolution: chart.resolution(),
        chartType: chart.chartType(),
        studies: studies,
      };
    })()
  `);
  return { success: true, ...state };
}

export async function setSymbol({ symbol, _deps }: any = {}) {
  const { evaluate, waitForChartReady } = _resolve(_deps);
  await evaluate(`${CHART_API}.setSymbol(${safeString(symbol)}, {})`);
  const { ok, value } = await waitForChartReady(symbol);
  if (!ok) {
    return { success: false, error: 'Chart did not switch to the requested symbol', expected: symbol, seen: value?.symbol ?? null };
  }
  return { success: true, symbol, chart_ready: true };
}

export async function setTimeframe({ timeframe, _deps }: any = {}) {
  const { evaluate, waitForChartReady } = _resolve(_deps);
  await evaluate(`${CHART_API}.setResolution(${safeString(timeframe)}, {})`);
  const { ok, value } = await waitForChartReady(null, timeframe);
  if (!ok) {
    return { success: false, error: 'Chart did not switch to the requested timeframe', expected: timeframe, seen: value?.resolution ?? null };
  }
  return { success: true, timeframe, chart_ready: true };
}

export async function setType({ chart_type, _deps }: any = {}) {
  const { evaluate, waitOpts } = _resolve(_deps);
  if (chart_type == null || String(chart_type).trim() === '') {
    throw new Error('chart_type is required. Use a name (Candles, Line, etc.) or number (0-9).');
  }
  const typeMap = {
    'Bars': 0, 'Candles': 1, 'Line': 2, 'Area': 3,
    'Renko': 4, 'Kagi': 5, 'PointAndFigure': 6, 'LineBreak': 7,
    'HeikinAshi': 8, 'HollowCandles': 9,
  };
  const typeNum = typeMap[chart_type] ?? Number(chart_type);
  if (isNaN(typeNum) || typeNum < 0 || typeNum > 9 || !Number.isInteger(typeNum)) {
    throw new Error(`Unknown chart type: ${chart_type}. Use a name (Candles, Line, etc.) or number (0-9).`);
  }
  await evaluate(`${CHART_API}.setChartType(${typeNum})`);
  const { ok, value } = await waitFor<number>(`${CHART_API}.chartType()`, (v) => v === typeNum, { timeout: 3000, ...waitOpts });
  if (!ok) {
    return { success: false, error: 'Chart type did not change', expected: typeNum, seen: value ?? null };
  }
  return { success: true, chart_type, type_num: typeNum };
}

const STUDY_IDS = `${CHART_API}.getAllStudies().map(function(s) { return s.id; })`;

export async function manageIndicator({ action, indicator, entity_id, inputs: inputsRaw, _deps }: any = {}) {
  const { evaluate, evaluateAsync, waitOpts } = _resolve(_deps);
  const inputs = inputsRaw ? parseJsonObject(inputsRaw, 'inputs') : undefined;

  if (action === 'add') {
    const beforeIds: string[] = (await evaluate(STUDY_IDS)) || [];
    // createStudy returns a promise; await it in the page so rejections surface here.
    const created = await evaluateAsync(`
      (async function() {
        try { await ${CHART_API}.createStudy(${safeString(indicator)}, false, false); return {}; }
        catch (e) { return { error: String((e && e.message) || e) }; }
      })()
    `);
    if (created?.error) throw new Error(`Failed to add indicator "${indicator}": ${created.error}`);

    const { value: after } = await waitFor<string[]>(
      STUDY_IDS,
      (ids) => ids.some(id => !beforeIds.includes(id)),
      { timeout: 5000, ...waitOpts },
    );
    const newIds = (after || []).filter(id => !beforeIds.includes(id));
    const newId = newIds[0] || null;
    if (!newId) {
      return { success: false, action: 'add', indicator, error: 'Indicator did not appear on the chart', entity_id: null, new_study_count: 0 };
    }

    if (inputs && Object.keys(inputs).length > 0) {
      const { setInputs } = await import('./indicators.js');
      const applied = await setInputs({ entity_id: newId, inputs, _deps }).catch((e: Error) => ({ success: false, error: e.message }));
      if (!applied.success) {
        return { success: false, action: 'add', indicator, entity_id: newId, new_study_count: newIds.length, inputs_error: applied.error };
      }
    }
    return { success: true, action: 'add', indicator, entity_id: newId, new_study_count: newIds.length };
  } else if (action === 'remove') {
    if (!entity_id) throw new Error('entity_id required for remove action. Use chart_get_state to find study IDs.');
    const existing: string[] = (await evaluate(STUDY_IDS)) || [];
    if (!existing.includes(entity_id)) {
      return { success: false, action: 'remove', entity_id, error: `Study not found: ${entity_id}. Use chart_get_state to find study IDs.` };
    }
    await evaluate(`${CHART_API}.removeEntity(${safeString(entity_id)})`);
    const { ok } = await waitFor<string[]>(STUDY_IDS, (ids) => !ids.includes(entity_id), { timeout: 3000, ...waitOpts });
    if (!ok) return { success: false, action: 'remove', entity_id, error: 'Study is still on the chart after removal' };
    return { success: true, action: 'remove', entity_id };
  } else {
    throw new Error('action must be "add" or "remove"');
  }
}

export async function getVisibleRange() {
  const result = await _evaluate(`
    (function() {
      var chart = ${CHART_API};
      return { visible_range: chart.getVisibleRange(), bars_range: chart.getVisibleBarsRange() };
    })()
  `);
  return { success: true, visible_range: result.visible_range, bars_range: result.bars_range };
}

interface ZoomResult {
  found: boolean;
  loaded_from: number | null;
  loaded_to: number | null;
  /** Times of the first and last loaded bars inside the requested range. */
  zoomed_from?: number;
  zoomed_to?: number;
}

interface TimeRange { from: number; to: number }

/** Zoom to the loaded bars inside [from, to]; does nothing when no loaded bar falls in the range. */
async function zoomToTimeRange(evaluate: (expr: string) => Promise<any>, from: number, to: number): Promise<ZoomResult> {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = chart._chartWidget.model();
      var ts = m.timeScale();
      var bars = m.mainSeries().bars();
      var startIdx = bars.firstIndex();
      var endIdx = bars.lastIndex();
      var first = bars.valueAt(startIdx), last = bars.valueAt(endIdx);
      var fromIdx = -1, toIdx = -1, zoomedFrom = null, zoomedTo = null;
      for (var i = startIdx; i <= endIdx; i++) {
        var v = bars.valueAt(i);
        if (!v || v[0] < ${from} || v[0] > ${to}) continue;
        if (fromIdx < 0) { fromIdx = i; zoomedFrom = v[0]; }
        toIdx = i;
        zoomedTo = v[0];
      }
      if (fromIdx >= 0) ts.zoomToBarsRange(fromIdx, toIdx);
      return { found: fromIdx >= 0, loaded_from: first ? first[0] : null, loaded_to: last ? last[0] : null, zoomed_from: zoomedFrom, zoomed_to: zoomedTo };
    })()
  `);
}

function notInLoadedRange(requested: object, zoom: ZoomResult) {
  return {
    success: false,
    error: 'not_in_loaded_range',
    message: 'No loaded bars fall in the requested range. Scroll further back on the chart to load more history.',
    requested,
    loaded: { from: zoom.loaded_from, to: zoom.loaded_to },
  };
}

/** Set when the request reaches past the loaded bars, so the chart zoomed to only a subset of it. */
function partialLoadFlag(requested: TimeRange, zoom: ZoomResult) {
  const partial = requested.from < zoom.loaded_from! || requested.to > zoom.loaded_to!;
  return partial ? { partially_loaded: true, loaded: { from: zoom.loaded_from, to: zoom.loaded_to } } : {};
}

/** Wait until the chart's visible range sits on the bars we zoomed to (the chart pads the edges slightly). */
async function waitForVisibleRange(zoom: ZoomResult, evaluate: (expr: string) => Promise<any>, waitOpts: object) {
  const expected: TimeRange = { from: zoom.zoomed_from!, to: zoom.zoomed_to! };
  const tolerance = Math.max((expected.to - expected.from) * 0.1, 1);
  const wait = await waitFor<TimeRange>(
    `(function() { var r = ${CHART_API}.getVisibleRange(); return { from: r.from, to: r.to }; })()`,
    (r) => Math.abs(r.from - expected.from) <= tolerance && Math.abs(r.to - expected.to) <= tolerance,
    { ...waitOpts, evaluate },
  );
  return { ...wait, expected };
}

export async function setVisibleRange({ from, to, _deps }: any = {}) {
  const { evaluate, waitOpts } = _resolve(_deps);
  const requested: TimeRange = { from: requireFinite(from, 'from'), to: requireFinite(to, 'to') };
  const zoom = await zoomToTimeRange(evaluate, requested.from, requested.to);
  if (!zoom.found) return notInLoadedRange({ from, to }, zoom);
  const { ok, value, expected } = await waitForVisibleRange(zoom, evaluate, waitOpts);
  if (!ok) {
    return { success: false, error: 'Visible range did not settle on the requested bars', requested, expected, seen: value ?? null };
  }
  return { success: true, requested, actual: value, ...partialLoadFlag(requested, zoom) };
}

const UNIT_SECONDS = { S: 1, D: 86400, W: 604800, M: 2592000 };

/** Seconds per bar for a TradingView resolution: "5" and "240" are minutes, "D"/"2D"/"3M"/"12M" are day/week/month multiples. */
export function secondsPerBar(resolution: string): number {
  const res = String(resolution).toUpperCase();
  const unit = /^(\d*)([SDWM])$/.exec(res);
  if (unit) return (unit[1] ? Number(unit[1]) : 1) * UNIT_SECONDS[unit[2]];
  if (/^\d+T$/.test(res)) return 1;
  const mins = parseInt(res, 10);
  return isNaN(mins) ? 60 : mins * 60;
}

export async function scrollToDate({ date, _deps }: any = {}) {
  const { evaluate, waitOpts } = _resolve(_deps);
  let timestamp: number;
  if (/^\d+$/.test(date)) {
    // 13-digit values are milliseconds
    timestamp = String(date).length >= 13 ? Math.floor(Number(date) / 1000) : Number(date);
  } else {
    timestamp = Math.floor(new Date(date).getTime() / 1000);
  }
  if (isNaN(timestamp)) throw new Error(`Could not parse date: ${date}. Use ISO format (2024-01-15) or unix timestamp.`);

  const resolution = await evaluate(`${CHART_API}.resolution()`);
  const halfWindow = 25 * secondsPerBar(resolution);
  const from = requireFinite(timestamp - halfWindow, 'from');
  const to = requireFinite(timestamp + halfWindow, 'to');

  const zoom = await zoomToTimeRange(evaluate, from, to);
  if (!zoom.found) return notInLoadedRange({ date, centered_on: timestamp, window: { from, to } }, zoom);
  const { ok, value, expected } = await waitForVisibleRange(zoom, evaluate, waitOpts);
  if (!ok) {
    return { success: false, error: 'Visible range did not settle on the requested bars', date, expected, seen: value ?? null };
  }
  return { success: true, date, centered_on: timestamp, resolution, window: { from, to }, ...partialLoadFlag({ from, to }, zoom) };
}

export async function symbolInfo() {
  const result = await _evaluate(`
    (function() {
      var chart = ${CHART_API};
      var info = chart.symbolExt();
      return {
        symbol: info.symbol, full_name: info.full_name, exchange: info.exchange,
        description: info.description, type: info.type, pro_name: info.pro_name,
        typespecs: info.typespecs, resolution: chart.resolution(), chart_type: chart.chartType()
      };
    })()
  `);
  return { success: true, ...result };
}

export async function symbolSearch({ query, type }: any = {}) {
  // Use TradingView's public symbol search REST API (works without auth)
  const params = new URLSearchParams({
    text: query,
    hl: '1',
    exchange: '',
    lang: 'en',
    search_type: type || '',
    domain: 'production',
  });

  const resp = await fetch(`https://symbol-search.tradingview.com/symbol_search/v3/?${params}`, {
    headers: { 'Origin': 'https://www.tradingview.com', 'Referer': 'https://www.tradingview.com/' },
  });
  if (!resp.ok) throw new Error(`Symbol search API returned ${resp.status}`);
  const data = await resp.json();

  const strip = s => (s || '').replace(/<\/?em>/g, '');
  const results = (data.symbols || data || []).slice(0, 15).map(r => ({
    symbol: strip(r.symbol),
    description: strip(r.description),
    exchange: r.exchange || r.prefix || '',
    type: r.type || '',
    full_name: r.exchange ? `${r.exchange}:${strip(r.symbol)}` : strip(r.symbol),
  }));

  return { success: true, query, source: 'rest_api', results, count: results.length };
}
