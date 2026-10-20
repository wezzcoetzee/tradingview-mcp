/**
 * Core batch execution logic.
 */
import { evaluate as _evaluate, getChartApi as _getChartApi, getChartCollection as _getChartCollection, safeString } from '../connection.js';
import { waitForChartReady as _waitForChartReady } from '../wait.js';
import { getOhlcv } from './data.js';
import { captureScreenshot as _captureScreenshot } from './capture.js';
import type { ReportProgress } from './progress.js';

export const BATCH_ACTIONS = ['screenshot', 'get_ohlcv', 'get_strategy_results'] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

const CHART_STATE = `(function() {
  var chart = window.TradingViewApi._activeChartWidgetWV.value();
  return { symbol: chart.symbol(), resolution: chart.resolution() };
})()`;

export async function batchRun({ symbols, timeframes, action, delay_ms, ohlcv_count, onProgress, _deps }: any = {}) {
  if (!BATCH_ACTIONS.includes(action)) {
    throw new Error(`Unknown batch action "${action}". Use one of: ${BATCH_ACTIONS.join(', ')}`);
  }
  const evaluate = _deps?.evaluate || _evaluate;
  const waitForChartReady = _deps?.waitForChartReady || _waitForChartReady;
  const tfs = timeframes && timeframes.length > 0 ? timeframes : [null];
  const delay = delay_ms ?? 2000;
  const results = [];
  const total = symbols.length * tfs.length;
  const progress: ReportProgress | undefined = onProgress;

  // setSymbol/setResolution live on the chart collection, or the chart API as a fallback.
  let chartPath: string | undefined;
  try { chartPath = await (_deps?.getChartCollection || _getChartCollection)(); } catch {}
  if (!chartPath) { try { chartPath = await (_deps?.getChartApi || _getChartApi)(); } catch {} }
  const setChart = async (symbol: string, tf: string | null) => {
    if (!chartPath) return;
    await evaluate(`${chartPath}.setSymbol(${safeString(symbol)})`);
    if (tf) await evaluate(`${chartPath}.setResolution(${safeString(tf)})`);
  };

  const original: { symbol: string; resolution: string } | null = await evaluate(CHART_STATE).catch(() => null);

  try {
    for (const symbol of symbols) {
      for (const tf of tfs) {
        const combo = { symbol, timeframe: tf };
        try {
          await setChart(symbol, tf);
          const ready = await waitForChartReady(symbol, tf);
          if (!ready.ok) {
            const seen = ready.value ? `${ready.value.symbol} ${ready.value.resolution}` : 'unknown';
            throw new Error(`Chart did not reach ${symbol}${tf ? ` ${tf}` : ''} (last seen: ${seen})`);
          }
          await new Promise(r => setTimeout(r, delay));

          let actionResult;
          if (action === 'screenshot') {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const shot = await (_deps?.captureScreenshot || _captureScreenshot)({ filename: `batch_${symbol}_${tf || 'default'}_${ts}` });
            actionResult = { file_path: shot.file_path };
          } else if (action === 'get_ohlcv') {
            actionResult = await getOhlcv({ count: ohlcv_count, summary: true, _deps: { evaluate } });
          } else {
            await new Promise(r => setTimeout(r, 1000));
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
          if (actionResult?.error) results.push({ ...combo, success: false, error: actionResult.error });
          else results.push({ ...combo, success: true, result: actionResult });
        } catch (err) {
          results.push({ ...combo, success: false, error: err.message });
        }
        await progress?.(results.length, total);
      }
    }
  } finally {
    if (original) {
      try {
        await setChart(original.symbol, original.resolution);
        await waitForChartReady(original.symbol, original.resolution);
      } catch {}
    }
  }

  const failed = results.filter(r => !r.success).length;
  return { success: failed === 0, total_iterations: results.length, successful: results.length - failed, failed, results };
}
