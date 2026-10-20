/**
 * Core data access logic.
 */
import { evaluate as _evaluate, evaluateAsync, KNOWN_PATHS, safeString } from '../connection.js';

const evaluate = _evaluate;
import { symbolMatches } from '../wait.js';

const MAX_OHLCV_BARS = 500;
const MAX_TRADES = 20;
const CHART_API = KNOWN_PATHS.chartApi;
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

// In-page helper: locate the first strategy data source on the chart.
// Used by getStrategyResults / getTrades / getEquity to avoid drift.
const FIND_STRATEGY_JS = `
  function findStrategy(sources) {
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (!s || !s.metaInfo) continue;
      var mi = s.metaInfo();
      if (!mi || mi.is_price_study !== false) continue;
      if (s.reportData || s.performance || s.ordersData || s.equityData) return s;
    }
    return null;
  }
`;

const ALLOWED_GRAPHICS_COLLECTIONS = new Set(['dwglines', 'dwglabels', 'dwgboxes', 'dwgtablecells']);
const ALLOWED_GRAPHICS_MAP_KEYS = new Set(['lines', 'labels', 'boxes', 'tableCells']);

export function buildGraphicsJS(collectionName, mapKey, filter) {
  if (!ALLOWED_GRAPHICS_COLLECTIONS.has(collectionName)) {
    throw new Error(`buildGraphicsJS: unsupported collectionName "${collectionName}"`);
  }
  if (!ALLOWED_GRAPHICS_MAP_KEYS.has(mapKey)) {
    throw new Error(`buildGraphicsJS: unsupported mapKey "${mapKey}"`);
  }
  return `
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      var available = [];
      var filter = ${safeString(filter || '')}.toLowerCase();
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          available.push(name);
          if (filter && name.toLowerCase().indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var items = [];
          try {
            var outer = pc.${collectionName};
            if (outer) {
              var inner = outer.get('${mapKey}');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  coll._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            }
          } catch(e) {}
          if (items.length === 0 && '${collectionName}' === 'dwgtablecells') {
            try {
              var tcOuter = pc.dwgtablecells;
              if (tcOuter) {
                var tcColl = tcOuter.get('tableCells');
                if (tcColl && tcColl._primitivesDataById && tcColl._primitivesDataById.size > 0) {
                  tcColl._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            } catch(e) {}
          }
          if (items.length > 0) results.push({name: name, count: items.length, items: items});
        } catch(e) {}
      }
      return {studies: results, available: available};
    })()
  `;
}

interface GraphicsItem { id: string | number; raw: Record<string, any> }
interface GraphicsStudy { name: string; count: number; items: GraphicsItem[] }

type Evaluate = typeof evaluate;

/**
 * Read one graphics collection from every study matching `filter` (case-insensitive).
 * A filter that matches nothing returns the available study names instead of a silent empty list.
 */
export async function readGraphics(collectionName: string, mapKey: string, filter = '', ev: Evaluate = evaluate) {
  const raw: { studies: GraphicsStudy[]; available: string[] } | null = await ev(buildGraphicsJS(collectionName, mapKey, filter));
  const studies = raw?.studies ?? [];
  const available = raw?.available ?? [];
  return { studies, notes: studyMissNotes(filter, available) };
}

/** Warning plus available study names when `filter` matches no study; empty otherwise. */
export function studyMissNotes(filter: string, available: string[]) {
  const missed = filter && !available.some(n => n.toLowerCase().includes(filter.toLowerCase()));
  return missed ? { warning: `No study name contains "${filter}"`, available_studies: available } : {};
}

const MAX_LEVELS = 50;

const isHorizontal = ({ raw }: GraphicsItem) => raw.y1 != null && raw.y1 === raw.y2;
const isBlankRow = (row: string) => !row.replace(/[ |]/g, '');

/**
 * Distinct horizontal price levels, newest lines first, capped; sloped lines are not levels.
 * With `currentOnly`, keeps just horizontal lines ending at the latest horizontal x2; lines without x2 are never current.
 */
export function horizontalLevels(items: GraphicsItem[], maxLevels = MAX_LEVELS, currentOnly = false): number[] {
  const horizontal = items.filter(isHorizontal);
  const lastBar = Math.max(...horizontal.map(({ raw }) => raw.x2 ?? -Infinity));
  const seen = new Set<number>();
  for (let i = horizontal.length - 1; i >= 0 && seen.size < maxLevels; i--) {
    const { y1, x2 } = horizontal[i].raw;
    if (!currentOnly || (x2 != null && x2 >= lastBar)) seen.add(y1);
  }
  return [...seen].sort((a, b) => b - a);
}

/** Text rows per table with empty cells and inner blank rows kept so indices stay aligned; trailing blank rows are trimmed. */
export function tableRows(items: GraphicsItem[]): { rows: string[] }[] {
  const tables = new Map<number, string[][]>();
  for (const { raw: v } of items) {
    const rows = tables.get(v.tid || 0) ?? [];
    (rows[v.row] ??= [])[v.col] = v.t || '';
    tables.set(v.tid || 0, rows);
  }
  return [...tables.values()].map(cells => {
    const rows = Array.from(cells, row => Array.from(row ?? [], c => c ?? '').join(' | '));
    while (rows.length && isBlankRow(rows[rows.length - 1])) rows.pop();
    return { rows };
  });
}

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

export function summarizeBars(bars: Bar[]) {
  let high = -Infinity, low = Infinity, volSum = 0;
  for (const b of bars) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    volSum += b.volume;
  }
  const first = bars[0];
  const last = bars[bars.length - 1];
  return {
    success: true, bar_count: bars.length,
    period: { from: first.time, to: last.time },
    open: first.open, close: last.close,
    high, low,
    range: high - low,
    change: last.close - first.open,
    change_pct: first.open !== 0
      ? Math.round(((last.close - first.open) / first.open) * 10000) / 100
      : null,
    avg_volume: Math.round(volSum / bars.length),
    last_5_bars: bars.slice(-5),
  };
}

export async function getOhlcv({ count, summary, _deps }: any = {}) {
  const ev: Evaluate = _deps?.evaluate || evaluate;
  const limit = Math.min(Math.max(1, Math.floor(count ?? 100)), MAX_OHLCV_BARS);
  const data = await ev(`
    (function() {
      var bars = ${BARS_PATH};
      if (!bars || typeof bars.lastIndex !== 'function') return null;
      var result = [];
      var end = bars.lastIndex();
      var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
      for (var i = start; i <= end; i++) {
        var v = bars.valueAt(i);
        if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
      }
      return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
    })()
  `);

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }
  if (summary) return summarizeBars(data.bars);
  return { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
}

const RESOLVE_INPUTS_JS = `
function resolveStudyInputs(study) {
  var pineInputs = [];
  try { pineInputs = study.getInputValues(); } catch(e) {}
  if (Array.isArray(pineInputs) && pineInputs.length > 0) return pineInputs;

  try {
    var props = typeof study.properties === 'function' ? study.properties() : study._properties;
    var inputsProp = props && props.inputs;
    if (inputsProp) {
      var childs = typeof inputsProp.childs === 'function' ? inputsProp.childs() : inputsProp;
      var INTERNAL = /^_/;
      var keys = Object.keys(childs).filter(function(k) { return !INTERNAL.test(k); });
      if (keys.length > 0) {
        return keys.map(function(k) {
          var node = childs[k];
          var v = node.value;
          var current;
          if (typeof v === 'object' && v !== null && typeof v.value === 'function') {
            current = v.value();
          } else if ('_value' in node) {
            current = node._value;
          } else if (typeof v === 'function') {
            try { current = v(); } catch(e2) {}
          }
          return { id: k, value: current };
        });
      }
    }
  } catch(e) {}

  return [];
}
`;

export async function getIndicator({ entity_id, _deps }: any = {}) {
  const ev = _deps?.evaluate || evaluate;
  const data = await ev(`
    (function() {
      ${RESOLVE_INPUTS_JS}
      var api = ${CHART_API};
      var study = api.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      var result = { inputs: null, visible: null };
      try { result.visible = study.isVisible(); } catch(e) {}
      result.inputs = resolveStudyInputs(study);
      return result;
    })()
  `);

  if (data?.error) throw new Error(data.error);

  let inputs = data?.inputs;
  if (Array.isArray(inputs)) {
    inputs = inputs.filter(inp => {
      if (inp.id === 'text' && typeof inp.value === 'string' && inp.value.length > 200) return false;
      if (typeof inp.value === 'string' && inp.value.length > 500) return false;
      return true;
    });
  }
  return { success: true, entity_id, visible: data?.visible, inputs };
}

export async function getStrategyResults({ _deps }: any = {}) {
  const ev: Evaluate = _deps?.evaluate || evaluate;
  const results = await ev(`
    (function() {
      ${FIND_STRATEGY_JS}
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = findStrategy(sources);
        if (!strat) return {metrics: {}, source: 'internal_api', error: 'No strategy found on chart. Add a strategy indicator first.'};
        var metrics = {};
        if (strat.reportData) {
          var rd = typeof strat.reportData === 'function' ? strat.reportData() : strat.reportData;
          if (rd && typeof rd === 'object') {
            if (typeof rd.value === 'function') rd = rd.value();
            if (rd) { var keys = Object.keys(rd); for (var k = 0; k < keys.length; k++) { var val = rd[keys[k]]; if (val !== null && val !== undefined && typeof val !== 'function') metrics[keys[k]] = val; } }
          }
        }
        if (Object.keys(metrics).length === 0 && strat.performance) {
          var perf = strat.performance();
          if (perf && typeof perf.value === 'function') perf = perf.value();
          if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { var pval = perf[pkeys[p]]; if (pval !== null && pval !== undefined && typeof pval !== 'function') metrics[pkeys[p]] = pval; } }
        }
        return {metrics: metrics, source: 'internal_api'};
      } catch(e) { return {metrics: {}, source: 'internal_api', error: e.message}; }
    })()
  `);
  if (results?.error) return { success: false, error: results.error };
  return { success: true, metric_count: Object.keys(results?.metrics || {}).length, source: results?.source, metrics: results?.metrics || {} };
}

export async function getTrades({ max_trades, offset, _deps }: any = {}) {
  const ev: Evaluate = _deps?.evaluate || evaluate;
  const limit = Math.max(1, Math.min(Math.floor(max_trades ?? MAX_TRADES), MAX_TRADES));
  // Without an offset, return the latest trades; with one, page forward from the oldest.
  const start = offset == null ? null : Math.max(0, Math.floor(offset));
  const trades = await ev(`
    (function() {
      ${FIND_STRATEGY_JS}
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = findStrategy(sources);
        if (!strat) return {error: 'No strategy found on chart.'};
        var orders = null;
        if (strat.ordersData) { orders = typeof strat.ordersData === 'function' ? strat.ordersData() : strat.ordersData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        if (!orders || !Array.isArray(orders)) {
          if (strat._orders) orders = strat._orders;
          else if (strat.tradesData) { orders = typeof strat.tradesData === 'function' ? strat.tradesData() : strat.tradesData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        }
        if (!orders || !Array.isArray(orders)) return {error: 'ordersData() returned non-array.'};
        var total = orders.length;
        var from = ${start === null ? `Math.max(0, total - ${limit})` : start};
        var result = [];
        for (var t = from; t < Math.min(total, from + ${limit}); t++) {
          var o = orders[t];
          if (typeof o === 'object' && o !== null) {
            var trade = {};
            var okeys = Object.keys(o);
            for (var k = 0; k < okeys.length; k++) {
              var v = o[okeys[k]];
              if (v === null || v === undefined || typeof v === 'function') continue;
              if (typeof v === 'object') { try { v = JSON.parse(JSON.stringify(v)); } catch(e2) { continue; } }
              trade[okeys[k]] = v;
            }
            result.push(trade);
          }
        }
        return {trades: result, total: total, offset: from, source: 'internal_api'};
      } catch(e) { return {error: e.message}; }
    })()
  `);
  if (!trades || trades.error) return { success: false, error: trades?.error ?? 'Could not read trades.' };
  return { success: true, trade_count: trades.trades.length, total: trades.total, offset: trades.offset, source: trades.source, trades: trades.trades };
}

export async function getEquity({ _deps }: any = {}) {
  const ev: Evaluate = _deps?.evaluate || evaluate;
  const equity = await ev(`
    (function() {
      ${FIND_STRATEGY_JS}
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = findStrategy(sources);
        if (!strat) return {data: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var data = [];
        if (strat.equityData) {
          var eq = typeof strat.equityData === 'function' ? strat.equityData() : strat.equityData;
          if (eq && typeof eq.value === 'function') eq = eq.value();
          if (Array.isArray(eq)) data = eq;
        }
        if (data.length === 0 && strat.bars) {
          var bars = typeof strat.bars === 'function' ? strat.bars() : strat.bars;
          if (bars && typeof bars.lastIndex === 'function') {
            var end = bars.lastIndex(); var start = bars.firstIndex();
            for (var i = start; i <= end; i++) { var v = bars.valueAt(i); if (v) data.push({time: v[0], equity: v[1], drawdown: v[2] || null}); }
          }
        }
        if (data.length === 0) {
          var perfData = {};
          if (strat.performance) {
            var perf = strat.performance();
            if (perf && typeof perf.value === 'function') perf = perf.value();
            if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { if (/equity|drawdown|profit|net/i.test(pkeys[p])) perfData[pkeys[p]] = perf[pkeys[p]]; } }
          }
          if (Object.keys(perfData).length > 0) return {data: [], equity_summary: perfData, source: 'internal_api', note: 'Full equity curve not available via API; equity summary metrics returned instead.'};
        }
        return {data: data, source: 'internal_api'};
      } catch(e) { return {data: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  if (equity?.error) return { success: false, error: equity.error };
  return { success: true, data_points: equity?.data?.length || 0, source: equity?.source, data: equity?.data || [], equity_summary: equity?.equity_summary, note: equity?.note };
}

export async function getQuote({ symbol, _deps }: any = {}) {
  const ev: Evaluate = _deps?.evaluate || evaluate;
  const data = await ev(`
    (function() {
      var api = ${CHART_API};
      var sym = '';
      try { sym = api.symbol(); } catch(e) {}
      if (!sym) { try { sym = api.symbolExt().symbol; } catch(e) {} }
      var ext = {};
      try { ext = api.symbolExt() || {}; } catch(e) {}
      var bars = ${BARS_PATH};
      var quote = { symbol: sym };
      if (bars && typeof bars.lastIndex === 'function') {
        var last = bars.valueAt(bars.lastIndex());
        if (last) { quote.time = last[0]; quote.open = last[1]; quote.high = last[2]; quote.low = last[3]; quote.close = last[4]; quote.last = last[4]; quote.volume = last[5] || 0; }
      }
      try {
        // Only read bid/ask when a DOM/Depth panel actually exists — otherwise
        // the [class*="bid"] / [class*="ask"] substring match picks up
        // unrelated obfuscated class names and yields garbage or NaN.
        var domPanel = document.querySelector('[data-name="dom"]')
          || document.querySelector('[class*="depth"]')
          || document.querySelector('[class*="dom-"]');
        if (domPanel) {
          var bidEl = domPanel.querySelector('[class*="bid"] [class*="price"], [class*="bid"]');
          var askEl = domPanel.querySelector('[class*="ask"] [class*="price"], [class*="ask"]');
          if (bidEl) {
            var bid = parseFloat(bidEl.textContent.replace(/[^0-9.\\-]/g, ''));
            if (Number.isFinite(bid)) quote.bid = bid;
          }
          if (askEl) {
            var ask = parseFloat(askEl.textContent.replace(/[^0-9.\\-]/g, ''));
            if (Number.isFinite(ask)) quote.ask = ask;
          }
        }
      } catch(e) {}
      try {
        var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
        if (hdr) { var hdrPrice = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(hdrPrice)) quote.header_price = hdrPrice; }
      } catch(e) {}
      if (ext.description) quote.description = ext.description;
      if (ext.exchange) quote.exchange = ext.exchange;
      if (ext.type) quote.type = ext.type;
      return quote;
    })()
  `);
  if (!data || (data.last == null && data.close == null)) throw new Error('Could not retrieve quote. The chart may still be loading.');
  // The quote is read from the active chart's bars, so another symbol would be mislabelled data.
  if (symbol && !symbolMatches(data.symbol ?? '', symbol)) {
    throw new Error(`Chart is on ${data.symbol}, not ${symbol}. quote_get only reads the active chart; call chart_set_symbol first.`);
  }
  return { success: true, ...data };
}

export async function getDepth() {
  const data = await evaluate(`
    (function() {
      var domPanel = document.querySelector('[class*="depth"]')
        || document.querySelector('[class*="orderBook"]')
        || document.querySelector('[class*="dom-"]')
        || document.querySelector('[class*="DOM"]')
        || document.querySelector('[data-name="dom"]');
      if (!domPanel) return { found: false, error: 'DOM / Depth of Market panel not found.' };
      var bids = [], asks = [], unclassified = [];
      var rows = domPanel.querySelectorAll('[class*="row"], tr');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var priceEl = row.querySelector('[class*="price"]');
        var sizeEl = row.querySelector('[class*="size"], [class*="volume"], [class*="qty"]');
        if (!priceEl) continue;
        var price = parseFloat(priceEl.textContent.replace(/[^0-9.\\-]/g, ''));
        var size = sizeEl ? parseFloat(sizeEl.textContent.replace(/[^0-9.\\-]/g, '')) : 0;
        if (isNaN(price)) continue;
        var rowClass = row.className || '';
        var rowHTML = row.innerHTML || '';
        if (/bid|buy/i.test(rowClass) || /bid|buy/i.test(rowHTML)) bids.push({ price, size });
        else if (/ask|sell/i.test(rowClass) || /ask|sell/i.test(rowHTML)) asks.push({ price, size });
        else unclassified.push({ price, size });
      }
      if (unclassified.length > 0 && bids.length === 0 && asks.length === 0) {
        return { found: true, raw_values: unclassified, warning: 'could not classify bid/ask sides — no class/HTML markers matched' };
      }
      if (bids.length === 0 && asks.length === 0) {
        var cells = domPanel.querySelectorAll('[class*="cell"], td');
        var prices = [];
        cells.forEach(function(c) { var val = parseFloat(c.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(val) && val > 0) prices.push(val); });
        if (prices.length > 0) return { found: true, raw_values: prices.slice(0, 50), bids: [], asks: [], note: 'Could not classify bid/ask levels.' };
      }
      bids.sort(function(a, b) { return b.price - a.price; });
      asks.sort(function(a, b) { return a.price - b.price; });
      var spread = null;
      if (asks.length > 0 && bids.length > 0) spread = +(asks[0].price - bids[0].price).toFixed(6);
      return { found: true, bids: bids, asks: asks, spread: spread };
    })()
  `);

  if (!data || !data.found) throw new Error(data?.error || 'DOM panel not found.');
  return { success: true, bid_levels: data.bids?.length || 0, ask_levels: data.asks?.length || 0, spread: data.spread, bids: data.bids || [], asks: data.asks || [], raw_values: data.raw_values, note: data.note };
}

export async function getStudyValues({ study_filter, _deps }: any = {}) {
  const ev: Evaluate = _deps?.evaluate || evaluate;
  const data = await ev(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      var available = [];
      var filter = ${safeString(study_filter || '')}.toLowerCase();
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          available.push(name);
          if (filter && name.toLowerCase().indexOf(filter) === -1) continue;
          var values = {};
          try {
            var dwv = s.dataWindowView();
            if (dwv) {
              var items = dwv.items();
              if (items) {
                for (var i = 0; i < items.length; i++) {
                  var item = items[i];
                  if (!item._value || item._value === '∅' || !item._title) continue;
                  var title = item._title, n = 2;
                  while (title in values) title = item._title + ' (' + n++ + ')';
                  values[title] = item._value;
                }
              }
            }
          } catch(e) {}
          var entityId = null;
          try { entityId = typeof s.id === 'function' ? s.id() : (s.id || null); } catch(e) {}
          if (Object.keys(values).length > 0) results.push({ entity_id: entityId, name: name, values: values });
        } catch(e) {}
      }
      return { studies: results, available: available };
    })()
  `);
  const studies = data?.studies ?? [];
  return { success: true, study_count: studies.length, studies, ...studyMissNotes(study_filter || '', data?.available ?? []) };
}

export async function getPineLines({ study_filter, verbose, max_levels, _deps }: any = {}) {
  const { studies: raw, notes } = await readGraphics('dwglines', 'lines', study_filter, _deps?.evaluate);
  const studies = raw.map(s => {
    const horizontal_levels = horizontalLevels(s.items, max_levels ?? MAX_LEVELS);
    const current_levels = horizontalLevels(s.items, max_levels ?? MAX_LEVELS, true);
    const result: any = { name: s.name, total_lines: s.count, horizontal_levels, current_levels };
    if (verbose) result.all_lines = s.items.map(({ id, raw: v }) => ({ id, y1: v.y1 ?? null, y2: v.y2 ?? null, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2, style: v.st, width: v.w, color: v.ci }));
    return result;
  });
  return { success: true, study_count: studies.length, studies, ...notes };
}

export async function getPineLabels({ study_filter, max_labels, verbose, _deps }: any = {}) {
  const { studies: raw, notes } = await readGraphics('dwglabels', 'labels', study_filter, _deps?.evaluate);
  const limit = Math.max(0, max_labels ?? 50);
  const studies = raw.map(s => {
    const labels = s.items.map(({ id, raw: v }) => {
      const text = v.t || '';
      const price = v.y != null ? v.y : null;
      if (verbose) return { id, text, price, x: v.x, yloc: v.yl, size: v.sz, textColor: v.tci, color: v.ci };
      return { text, price };
    }).filter(l => l.text || l.price != null);
    const shown = labels.slice(Math.max(0, labels.length - limit));
    return { name: s.name, total_labels: s.count, showing: shown.length, labels: shown };
  });
  return { success: true, study_count: studies.length, studies, ...notes };
}

export async function getPineTables({ study_filter, _deps }: any = {}) {
  const { studies: raw, notes } = await readGraphics('dwgtablecells', 'tableCells', study_filter, _deps?.evaluate);
  const studies = raw.map(s => ({ name: s.name, tables: tableRows(s.items) }));
  return { success: true, study_count: studies.length, studies, ...notes };
}

export async function getPineBoxes({ study_filter, verbose, _deps }: any = {}) {
  const { studies: raw, notes } = await readGraphics('dwgboxes', 'boxes', study_filter, _deps?.evaluate);
  const studies = raw.map(s => {
    const zones = [];
    const seen = {};
    const allBoxes = [];
    for (const item of s.items) {
      const v = item.raw;
      const high = v.y1 != null && v.y2 != null ? Math.max(v.y1, v.y2) : null;
      const low = v.y1 != null && v.y2 != null ? Math.min(v.y1, v.y2) : null;
      if (verbose) allBoxes.push({ id: item.id, high, low, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc });
      if (high != null && low != null) { const key = high + ':' + low; if (!seen[key]) { zones.push({ high, low }); seen[key] = true; } }
    }
    zones.sort((a, b) => b.high - a.high);
    const result: any = { name: s.name, total_boxes: s.count, zones };
    if (verbose) result.all_boxes = allBoxes;
    return result;
  });
  return { success: true, study_count: studies.length, studies, ...notes };
}
