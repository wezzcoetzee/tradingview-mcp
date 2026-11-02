/**
 * Snippets and helpers shared by the core modules.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, KNOWN_PATHS } from '../connection.js';
import { waitForChartReady as _waitForChartReady, type WaitOptions } from '../wait.js';

export const CHART_API = KNOWN_PATHS.chartApi;

/** In-page function declaration that unwraps TradingView watched values (objects with a .value() method). */
export const UNWRAP_FN = `function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }`;

export const HIDDEN_WINDOW_WARNING =
  'TradingView window is hidden (screen locked or minimized): the on-screen legend and CDP screenshots are stale. '
  + 'The chart API state is current; capture_screenshot renders from it (method "snapshot").';

/** Fields to merge into a result when the TradingView window cannot repaint. */
export function hiddenWindowNote(hidden: boolean | undefined) {
  return hidden ? { window_hidden: true, warning: HIDDEN_WINDOW_WARNING } : {};
}

export const sleep =(ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface CoreDeps {
  evaluate?: typeof _evaluate;
  evaluateAsync?: typeof _evaluateAsync;
  waitForChartReady?: typeof _waitForChartReady;
  waitOpts?: WaitOptions;
}

/** Param shape shared by every core function that accepts injected dependencies. */
export interface WithDeps<D = CoreDeps> {
  _deps?: D;
}

/** Own-property lookup, so user strings like "constructor" never resolve to inherited Object members. */
export function own<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
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
