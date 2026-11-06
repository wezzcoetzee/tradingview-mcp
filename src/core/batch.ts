/**
 * Core batch execution logic.
 */
import { evaluate as _evaluate, getChartApi as _getChartApi, getChartCollection as _getChartCollection, safeString } from '../connection.js';
import { waitForChartReady as _waitForChartReady } from '../wait.js';
import { getOhlcv, getStudyValues, getPineLines, getPineLabels, getPineTables, getPineBoxes } from './data.js';
import { bounded } from './history.js';
import { symbolMatches, resolutionMatches } from '../wait.js';
import { captureScreenshot as _captureScreenshot } from './capture.js';
import type { ReportProgress } from './progress.js';
import { sleep, type CoreDeps, type WithDeps } from './_page.js';
import { errorMessage } from '../debug.js';

export const BATCH_ACTIONS = ['screenshot', 'get_ohlcv', 'get_strategy_results', 'get_study_values', 'get_pine_lines', 'get_pine_labels', 'get_pine_tables', 'get_pine_boxes', 'collect_analysis'] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

function identityMatches(actual: string, expected: string) {
  return actual.includes(':') && expected.includes(':') ? actual.toUpperCase() === expected.toUpperCase() : symbolMatches(actual, expected);
}

const CHART_STATE = `(function() {
  var chart = window.TradingViewApi._activeChartWidgetWV.value();
  return { symbol: chart.symbol(), resolution: chart.resolution(), range: typeof chart.getVisibleBarsRange === 'function' ? chart.getVisibleBarsRange() : null };
})()`;

export interface BatchDeps extends CoreDeps {
  getChartApi?: typeof _getChartApi;
  getChartCollection?: typeof _getChartCollection;
  captureScreenshot?: typeof _captureScreenshot;
}

export interface BatchRunParams extends WithDeps<BatchDeps> {
  symbols: string[];
  timeframes?: string[];
  action: BatchAction;
  /** Delay after each chart change, in milliseconds. */
  delay_ms?: number;
  ohlcv_count?: number;
  study_filter?: string;
  max_items?: number;
  onProgress?: ReportProgress;
}

export async function batchRun({ symbols, timeframes, action, delay_ms, ohlcv_count, study_filter, max_items, onProgress, _deps }: BatchRunParams) {
  if (!BATCH_ACTIONS.includes(action)) {
    throw new Error(`Unknown batch action "${action}". Use one of: ${BATCH_ACTIONS.join(', ')}`);
  }
  const evaluate = _deps?.evaluate || _evaluate;
  const waitForChartReady = _deps?.waitForChartReady || _waitForChartReady;
  const tfs = timeframes && timeframes.length > 0 ? timeframes : [null];
  const delay = bounded(delay_ms, 2000, 10000, 'delay_ms', 0);
  const limit = bounded(max_items, 20, 50, 'max_items');
  bounded(ohlcv_count, 100, 500, 'ohlcv_count');
  if (!symbols.length || symbols.some(s => !s.trim()) || timeframes?.some(t => !t.trim()) || symbols.length * tfs.length > 100) throw new Error('Batch requires nonempty symbols/timeframes and at most 100 iterations');
  const results = [];
  const total = symbols.length * tfs.length;
  const progress: ReportProgress | undefined = onProgress;

  // setSymbol/setResolution live on the chart collection, or the chart API as a fallback.
  let chartPath: string | undefined;
  try { chartPath = await (_deps?.getChartCollection || _getChartCollection)(); } catch {}
  if (!chartPath) { try { chartPath = await (_deps?.getChartApi || _getChartApi)(); } catch {} }
  const setChart = async (symbol: string, tf: string | null) => {
    if (!chartPath) throw new Error('Chart switching API unavailable');
    await evaluate(`${chartPath}.setSymbol(${safeString(symbol)})`);
    if (tf) await evaluate(`${chartPath}.setResolution(${safeString(tf)})`);
  };

  const original: { symbol: string; resolution: string; range?: { from: number; to: number } | null } | null = await evaluate(CHART_STATE).catch(() => null);

  let restoration: { success: boolean; symbol_timeframe: boolean; range: 'restored' | 'unavailable' | 'failed'; error?: string } = { success: false, symbol_timeframe: false, range: 'unavailable' };
  if (!original) throw new Error('Cannot preserve original chart state');
  const compact = (value: unknown): unknown => {
    let remaining = 24000;
    const visit = (v: unknown, depth: number): unknown => {
      if (remaining <= 0 || depth > 8) return '[payload limit]';
      remaining -= 20;
      if (typeof v === 'string') {
        const result = v.slice(0, Math.max(0, Math.min(500, remaining)));
        remaining -= result.length;
        return result.length < v.length ? result + '[truncated]' : result;
      }
      if (Array.isArray(v)) {
        const result: unknown[] = [];
        for (const item of v.slice(0, limit)) { if (remaining <= 0) break; result.push(visit(item, depth + 1)); }
        return result;
      }
      if (v && typeof v === 'object') {
        const result: Record<string, unknown> = {};
        for (const [k, item] of Object.entries(v).slice(0, 50)) {
          if (remaining <= 0) break;
          const key = k.slice(0, Math.min(500, Math.max(0, remaining)));
          remaining -= key.length;
          result[key] = visit(item, depth + 1);
        }
        return result;
      }
      return v;
    };
    return visit(value, 0);
  };
  const collect = async (name: BatchAction): Promise<unknown> => {
    const deps = { evaluate };
    const opts = { study_filter, max_levels: limit, max_labels: limit, _deps: deps };
    if (name === 'get_study_values') {
      const data = await getStudyValues({ _deps: deps });
      const studies = data.studies.filter((s: { name: string }) => !study_filter || s.name.toLowerCase().includes(study_filter.toLowerCase()));
      return { ...data, study_count: studies.length, studies };
    }
    if (name === 'get_pine_lines') return getPineLines(opts);
    if (name === 'get_pine_labels') return getPineLabels(opts);
    if (name === 'get_pine_tables') return getPineTables(opts);
    if (name === 'get_pine_boxes') return getPineBoxes(opts);
    throw new Error(`Unsupported collection ${name}`);
  };
  try {
    for (const symbol of symbols) {
      for (const tf of tfs) {
        const combo = { symbol, timeframe: tf ?? original.resolution, captured_at: new Date().toISOString() };
        try {
          await setChart(symbol, tf);
          const ready = await waitForChartReady(symbol, tf ?? original.resolution, undefined, { evaluate });
          if (!ready.ok) {
            const seen = ready.value ? `${ready.value.symbol} ${ready.value.resolution}` : 'unknown';
            throw new Error(`Chart did not reach ${symbol}${tf ? ` ${tf}` : ''} (last seen: ${seen})`);
          }
          await sleep(delay);

          const seen: { symbol: string; resolution: string } = await evaluate(CHART_STATE);
          if (!seen || !identityMatches(seen.symbol, symbol) || !resolutionMatches(seen.resolution, tf ?? original.resolution)) throw new Error('Chart identity changed before capture');
          combo.symbol = seen.symbol;
          combo.timeframe = seen.resolution;
          combo.captured_at = new Date().toISOString();
          let actionResult;
          if (action === 'screenshot') {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const shot = await (_deps?.captureScreenshot || _captureScreenshot)({ filename: `batch_${symbol}_${tf || 'default'}_${ts}` });
            actionResult = { file_path: 'file_path' in shot ? shot.file_path : undefined };
          } else if (action === 'get_ohlcv') {
            actionResult = await getOhlcv({ count: ohlcv_count, summary: true, _deps: { evaluate } });
          } else if (action === 'collect_analysis') {
            const observations: Record<string, unknown> = { ohlcv: await getOhlcv({ count: ohlcv_count, summary: true, _deps: { evaluate } }) };
            for (const name of ['get_study_values', 'get_pine_lines', 'get_pine_labels', 'get_pine_tables', 'get_pine_boxes'] as const) observations[name] = compact(await collect(name));
            actionResult = { success: true, observations, max_items: limit, output_bounded: true };
          } else if (action !== 'get_strategy_results') {
            actionResult = { success: true, data: compact(await collect(action)), max_items: limit, output_bounded: true };
          } else {
            await sleep(1000);
            actionResult = await evaluate(`
              (function() {
                var metrics = {};
                var panel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]');
                if (!panel) return { error: 'Strategy Tester not found' };
                var items = panel.querySelectorAll('[class*="reportItem"], [class*="metric"]');
                items.forEach(function(item) {
                  var label = item.querySelector('[class*="label"]');
                  var value = item.querySelector('[class*="value"]');
                  if (label && value) metrics[label.textContent.trim()] = value.textContent.trim();
                });
                return { metric_count: Object.keys(metrics).length, metrics: metrics };
              })()
            `);
          }
          const after: { symbol: string; resolution: string } = await evaluate(CHART_STATE);
          if (!after || !identityMatches(after.symbol, seen.symbol) || !resolutionMatches(after.resolution, seen.resolution)) throw new Error('Chart identity changed during capture');
          if (actionResult?.error) results.push({ ...combo, success: false, error: actionResult.error });
          else results.push({ ...combo, success: true, result: actionResult });
        } catch (err) {
          results.push({ ...combo, success: false, error: errorMessage(err) });
        }
        await progress?.(results.length, total);
      }
    }
  } finally {
    try {
      await setChart(original.symbol, original.resolution);
      const ready = await waitForChartReady(original.symbol, original.resolution, undefined, { evaluate });
      const seen: { symbol: string; resolution: string } = await evaluate(CHART_STATE);
      restoration.symbol_timeframe = ready.ok && !!seen && identityMatches(seen.symbol, original.symbol) && resolutionMatches(seen.resolution, original.resolution);
      if (!restoration.symbol_timeframe) throw new Error('Original symbol/timeframe did not settle');
      if (original.range && Number.isFinite(original.range.from) && Number.isFinite(original.range.to)) {
        restoration.range = 'failed';
        const ok: boolean = await evaluate(`(function() {
          var chart = window.TradingViewApi._activeChartWidgetWV.value();
          chart._chartWidget.model().timeScale().zoomToBarsRange(${original.range.from}, ${original.range.to});
          var r = chart.getVisibleBarsRange();
          return !!r && Math.abs(r.from - ${original.range.from}) < 1 && Math.abs(r.to - ${original.range.to}) < 1;
        })()`);
        restoration.range = ok ? 'restored' : 'failed';
        if (!ok) throw new Error('Original visible range did not settle');
      }
      restoration.success = true;
    } catch (err) { restoration.error = errorMessage(err); }
  }

  const failed = results.filter(r => !r.success).length;
  return { success: failed === 0 && restoration.success, restoration, total_iterations: results.length, successful: results.length - failed, failed, results };
}
