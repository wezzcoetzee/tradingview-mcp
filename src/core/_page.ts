/**
 * Snippets and helpers shared by the core modules.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, KNOWN_PATHS } from '../connection.js';
import { waitForChartReady as _waitForChartReady } from '../wait.js';

export const CHART_API = KNOWN_PATHS.chartApi;

/** In-page function declaration that unwraps TradingView watched values (objects with a .value() method). */
export const UNWRAP_FN = `function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }`;

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface CoreDeps {
  evaluate?: typeof _evaluate;
  evaluateAsync?: typeof _evaluateAsync;
  waitForChartReady?: typeof _waitForChartReady;
  waitOpts?: object;
}

/** Fill in the real connection functions for any dependency a caller (usually a test) did not inject. */
export function resolveDeps(deps?: CoreDeps) {
  const evaluate = deps?.evaluate || _evaluate;
  return {
    evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    waitForChartReady: deps?.waitForChartReady || _waitForChartReady,
    waitOpts: { evaluate, ...deps?.waitOpts },
  };
}
