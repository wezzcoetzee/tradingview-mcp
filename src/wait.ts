import { evaluate as _evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  evaluate?: typeof _evaluate;
}

export interface WaitResult<T> {
  ok: boolean;
  /** The last value the expression returned, so callers can report what was seen on timeout. */
  value: T | undefined;
}

/**
 * Poll a page expression until `done(value)` holds or the timeout passes.
 * Evaluation errors count as "not yet" so a chart mid-reload doesn't abort the wait.
 */
export async function waitFor<T>(
  expression: string,
  done: (value: T) => boolean,
  { timeout = DEFAULT_TIMEOUT, interval = POLL_INTERVAL, evaluate = _evaluate }: WaitOptions = {},
): Promise<WaitResult<T>> {
  const deadline = Date.now() + timeout;
  let value: T | undefined;
  for (;;) {
    try {
      value = await evaluate(expression);
      if (value !== undefined && value !== null && done(value)) return { ok: true, value };
    } catch {}
    if (Date.now() + interval > deadline) return { ok: false, value };
    await new Promise(r => setTimeout(r, interval));
  }
}

export interface ChartSnapshot {
  symbol: string;
  resolution: string;
  bars: number;
  /** Symbol description from the API, e.g. "Zcash / US Dollar". */
  description: string;
  /** Title text of the main series legend as rendered on screen, null when the legend is not shown. */
  legend: string | null;
  /**
   * document.hidden: the window is minimized or the screen is locked. TradingView then stops
   * repainting its DOM (legend, dialogs), so the legend and CDP screenshots go stale while the API moves on.
   */
  hidden: boolean;
}

/** Legend title of the main series; shared with tv_ui_state. */
export const LEGEND_TITLE = `(function() {
  var el = document.querySelector('[class*="legendMainSourceWrapper"] [class*="title-"]');
  return el ? el.textContent.trim() : null;
})()`;

const CHART_SNAPSHOT = `
  (function() {
    var chart = window.TradingViewApi._activeChartWidgetWV.value();
    var bars = chart._chartWidget.model().mainSeries().bars();
    return {
      symbol: chart.symbol(), resolution: chart.resolution(), bars: bars.size(),
      description: chart.symbolExt().description, legend: ${LEGEND_TITLE}, hidden: document.hidden,
    };
  })()
`;

/** "NASDAQ:AAPL" and "AAPL" name the same chart symbol. */
export function symbolMatches(actual: string, expected: string): boolean {
  const bare = (s: string) => s.toUpperCase().split(':').pop();
  return bare(actual) === bare(expected);
}

/**
 * Whether the on-screen legend names the chart's symbol. The legend shows the description or the
 * ticker depending on the user's settings; a missing legend (hidden by the user) cannot disagree.
 */
export function legendMatches({ legend, description, symbol }: Pick<ChartSnapshot, 'legend' | 'description' | 'symbol'>): boolean {
  if (!legend) return true;
  const shown = legend.toUpperCase();
  return shown.includes(description.toUpperCase()) || shown.includes(symbol.toUpperCase().split(':').pop() ?? '');
}

/** TradingView reports daily/weekly/monthly as "1D"/"1W"/"1M" but accepts "D"/"W"/"M". */
export function resolutionMatches(actual: string, expected: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/^1(?=[DWMS]$)/, '');
  return norm(actual) === norm(expected);
}

/**
 * Wait until the active chart shows the expected symbol/resolution, its bar count has held
 * steady for two polls and, when the window is visible, the on-screen legend agrees.
 * A hidden window cannot repaint its legend, so callers should surface `value.hidden`.
 * Returns the last snapshot either way.
 */
export async function waitForChartReady(
  expectedSymbol: string | null = null,
  expectedTf: string | null = null,
  timeout = DEFAULT_TIMEOUT,
  opts: Omit<WaitOptions, 'timeout'> = {},
): Promise<WaitResult<ChartSnapshot>> {
  let lastBars = -1;
  let stable = 0;
  return waitFor<ChartSnapshot>(CHART_SNAPSHOT, (s) => {
    if (expectedSymbol && !symbolMatches(s.symbol, expectedSymbol)) return false;
    if (expectedTf && !resolutionMatches(s.resolution, expectedTf)) return false;
    stable = s.bars > 0 && s.bars === lastBars ? stable + 1 : 0;
    lastBars = s.bars;
    return stable >= 2 && (s.hidden || legendMatches(s));
  }, { ...opts, timeout });
}
