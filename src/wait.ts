import { evaluate as _evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  evaluate?: (expression: string) => Promise<any>;
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
}

const CHART_SNAPSHOT = `
  (function() {
    var chart = window.TradingViewApi._activeChartWidgetWV.value();
    var bars = chart._chartWidget.model().mainSeries().bars();
    return { symbol: chart.symbol(), resolution: chart.resolution(), bars: bars.size() };
  })()
`;

/** "NASDAQ:AAPL" and "AAPL" name the same chart symbol. */
export function symbolMatches(actual: string, expected: string): boolean {
  const bare = (s: string) => s.toUpperCase().split(':').pop();
  return bare(actual) === bare(expected);
}

/** TradingView reports daily/weekly/monthly as "1D"/"1W"/"1M" but accepts "D"/"W"/"M". */
export function resolutionMatches(actual: string, expected: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/^1(?=[DWMS]$)/, '');
  return norm(actual) === norm(expected);
}

/**
 * Wait until the active chart shows the expected symbol/resolution and its bar
 * count has held steady for two polls. Returns the last snapshot either way.
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
    return stable >= 2;
  }, { ...opts, timeout });
}
