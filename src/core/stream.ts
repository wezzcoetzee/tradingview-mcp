/**
 * Core streaming logic — real-time JSONL output from TradingView.
 * Uses efficient poll + dedup: only emits when data changes.
 */
import { evaluate } from '../connection.js';
import { readGraphics, horizontalLevels, tableRows } from './data.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
const MODEL = `${CHART_API}._chartWidget.model()`;

/**
 * Generic poll-and-diff loop.
 * Calls fetcher(), compares to last value, emits JSONL on change.
 * Writes to stdout directly for pipe-friendliness.
 */
const MAX_CONSECUTIVE_ERRORS = 10;
const MAX_BACKOFF_MS = 30_000;

/** Exponential backoff: interval doubles with each consecutive error, capped. */
export function backoffMs(consecutiveErrors: number, interval: number) {
  return Math.min(interval * 2 ** consecutiveErrors, MAX_BACKOFF_MS);
}

export async function pollLoop(fetcher, { interval = 500, dedupe = true, label = 'stream', signal, maxErrors = MAX_CONSECUTIVE_ERRORS }: any = {}) {
  let lastHash = null;
  const controller = new AbortController();
  const cleanup = () => controller.abort();

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  if (signal) signal.addEventListener('abort', cleanup, { once: true });

  const start = Date.now();
  process.stderr.write(`\u26A0  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n`);
  process.stderr.write(`   Streams from your locally running TradingView Desktop instance only.\n`);
  process.stderr.write(`   Does not connect to TradingView servers. Requires --remote-debugging-port=9222.\n`);
  process.stderr.write(`   Ensure your usage complies with TradingView's Terms of Use.\n`);
  process.stderr.write(`[stream:${label}] started, interval=${interval}ms, Ctrl+C to stop\n`);

  let consecutiveErrors = 0;
  try {
    while (!controller.signal.aborted) {
      try {
        const data = await fetcher();
        consecutiveErrors = 0;
        if (!data) { await sleep(interval, controller.signal); continue; }

        const hash = dedupe ? JSON.stringify(data) : null;
        if (!dedupe || hash !== lastHash) {
          lastHash = hash;
          const line = JSON.stringify({ ...data, _ts: Date.now(), _stream: label });
          process.stdout.write(line + '\n');
        }
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxErrors) {
          process.stderr.write(`[stream:${label}] aborting after ${consecutiveErrors} consecutive errors: ${err.message}\n`);
          break;
        }
        process.stderr.write(`[stream:${label}] error (${consecutiveErrors}/${maxErrors}): ${err.message}\n`);
        await sleep(backoffMs(consecutiveErrors, interval), controller.signal);
        continue;
      }
      await sleep(interval, controller.signal);
    }
  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
    process.stderr.write(`[stream:${label}] stopped after ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ── Stream: quote ──

async function fetchQuote() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var last = bars.lastIndex();
      var v = bars.valueAt(last);
      if (!v) return null;
      return {
        symbol: chart.symbol(),
        time: v[0],
        open: v[1],
        high: v[2],
        low: v[3],
        close: v[4],
        volume: v[5] || 0,
      };
    })()
  `);
}

export async function streamQuote({ interval }: any = {}) {
  return pollLoop(fetchQuote, { interval: interval || 300, label: 'quote' });
}

// ── Stream: ohlcv (last N bars, emits on new bar) ──

async function fetchLastBar() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var last = bars.lastIndex();
      var v = bars.valueAt(last);
      if (!v) return null;
      return {
        symbol: chart.symbol(),
        resolution: chart.resolution(),
        bar_time: v[0],
        open: v[1],
        high: v[2],
        low: v[3],
        close: v[4],
        volume: v[5] || 0,
        bar_index: last,
      };
    })()
  `);
}

export async function streamBars({ interval }: any = {}) {
  return pollLoop(fetchLastBar, { interval: interval || 500, label: 'bars' });
}

// ── Stream: indicator values ──

async function fetchValues() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        try {
          var study = chart.getStudyById(studies[i].id);
          if (!study || !study.isVisible()) continue;
          var src = study._study || study;
          var data = src._lastBarValues || src._data;
          if (!data) continue;
          var vals = {};
          if (typeof data === 'object') {
            for (var k in data) {
              if (typeof data[k] === 'number' && !isNaN(data[k])) vals[k] = data[k];
            }
          }
          if (Object.keys(vals).length > 0) results.push({ name: studies[i].name, values: vals });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamValues({ interval }: any = {}) {
  return pollLoop(fetchValues, { interval: interval || 500, label: 'values' });
}

// ── Stream: pine graphics (shares the walker with the data_get_pine_* tools) ──

const fetchSymbol = () => evaluate(`${CHART_API}.symbol()`);

async function fetchGraphics<T>(collection: string, mapKey: string, filter: string | undefined, toEntry: (study: Awaited<ReturnType<typeof readGraphics>>['studies'][number]) => T | null) {
  const [{ studies }, symbol] = await Promise.all([readGraphics(collection, mapKey, filter), fetchSymbol()]);
  const entries = studies.map(toEntry).filter((e): e is NonNullable<T> => e !== null);
  return { symbol, study_count: entries.length, studies: entries };
}

export async function streamLines({ interval, filter }: any = {}) {
  const fetchLines = () => fetchGraphics('dwglines', 'lines', filter, (s) => {
    const levels = horizontalLevels(s.items);
    return levels.length > 0 ? { study: s.name, levels } : null;
  });
  return pollLoop(fetchLines, { interval: interval || 1000, label: 'lines' });
}

export async function streamLabels({ interval, filter }: any = {}) {
  const fetchLabels = () => fetchGraphics('dwglabels', 'labels', filter, (s) => {
    const labels = s.items
      .map(({ raw: v }) => ({ text: v.t || '', price: v.y ?? null }))
      .filter(l => l.text)
      .slice(-50);
    return labels.length > 0 ? { study: s.name, labels } : null;
  });
  return pollLoop(fetchLabels, { interval: interval || 1000, label: 'labels' });
}

export async function streamTables({ interval, filter }: any = {}) {
  const fetchTables = () => fetchGraphics('dwgtablecells', 'tableCells', filter, (s) => {
    const tables = tableRows(s.items);
    return tables.length > 0 ? { study: s.name, tables } : null;
  });
  return pollLoop(fetchTables, { interval: interval || 2000, label: 'tables' });
}

// ── Stream: all panes (multi-symbol) ──

const CWC = 'window.TradingViewApi._chartWidgetCollection';

async function fetchAllPanes() {
  return evaluate(`
    (function() {
      var cwc = ${CWC};
      var all = cwc.getAll();
      var layoutType = cwc._layoutType;
      if (typeof layoutType === 'object' && layoutType && typeof layoutType.value === 'function') layoutType = layoutType.value();
      var count = cwc.inlineChartsCount;
      if (typeof count === 'object' && count && typeof count.value === 'function') count = count.value();

      var panes = [];
      for (var i = 0; i < Math.min(all.length, count || all.length); i++) {
        try {
          var c = all[i];
          var model = c.model();
          var ms = model.mainSeries();
          var bars = ms.bars();
          var last = bars.lastIndex();
          var v = bars.valueAt(last);
          if (!v) { panes.push({ index: i, symbol: ms.symbol(), error: 'no bars' }); continue; }
          panes.push({
            index: i,
            symbol: ms.symbol(),
            resolution: ms.interval(),
            time: v[0],
            open: v[1],
            high: v[2],
            low: v[3],
            close: v[4],
            volume: v[5] || 0,
          });
        } catch(e) { panes.push({ index: i, error: e.message }); }
      }
      return { layout: layoutType, pane_count: panes.length, panes: panes };
    })()
  `);
}

export async function streamAllPanes({ interval }: any = {}) {
  return pollLoop(fetchAllPanes, { interval: interval || 500, label: 'all-panes' });
}
