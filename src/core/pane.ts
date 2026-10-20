/**
 * Core pane/layout management logic.
 * Controls multi-chart layouts (split panes) in TradingView.
 */
import { evaluate as _evaluate, evaluateAsync, getClient, safeString, requireText } from '../connection.js';
import { waitFor, symbolMatches } from '../wait.js';

const CWC = 'window.TradingViewApi._chartWidgetCollection';

/** Index of the active pane in the collection, or -1 when none matches. */
const ACTIVE_PANE_INDEX = `(function() {
  var active = window.TradingViewApi._activeChartWidgetWV.value();
  var all = ${CWC}.getAll();
  for (var i = 0; i < all.length; i++) {
    if (active._chartWidget && all[i] === active._chartWidget) return i;
  }
  return -1;
})()`;

function _resolve(deps) {
  const evaluate = deps?.evaluate || _evaluate;
  return { evaluate, waitOpts: { evaluate, ...deps?.waitOpts } };
}

const LAYOUT_ALIASES = {
  'single': 's', '1': 's', '1x1': 's',
  '2x1': '2h', '1x2': '2v',
  '2x2': '4', 'grid': '4', 'quad': '4',
  '3x1': '3h', '1x3': '3v',
};

const LAYOUT_NAMES = {
  's': '1 chart',
  '2h': '2 horizontal',
  '2v': '2 vertical',
  '2-1': '2 top, 1 bottom',
  '1-2': '1 top, 2 bottom',
  '3h': '3 horizontal',
  '3v': '3 vertical',
  '3s': '3 custom',
  '4': '2x2 grid',
  '4h': '4 horizontal',
  '4v': '4 vertical',
  '4s': '4 custom',
  '6': '6 charts',
  '8': '8 charts',
  '10': '10 charts',
  '12': '12 charts',
  '14': '14 charts',
  '16': '16 charts',
};

/** Every layout code or friendly alias setLayout accepts. */
export const LAYOUT_INPUTS = [...Object.keys(LAYOUT_NAMES), ...Object.keys(LAYOUT_ALIASES)] as [string, ...string[]];

/**
 * List all panes in the current layout with their symbols and index.
 */
export async function list({ _deps }: any = {}) {
  const { evaluate } = _resolve(_deps);
  const result = await evaluate(`
    (function() {
      var cwc = ${CWC};
      var layoutType = cwc._layoutType;
      if (typeof layoutType === 'object' && layoutType && typeof layoutType.value === 'function') layoutType = layoutType.value();
      var count = cwc.inlineChartsCount;
      if (typeof count === 'object' && count && typeof count.value === 'function') count = count.value();

      var all = cwc.getAll();
      var panes = [];
      for (var i = 0; i < all.length; i++) {
        try {
          var c = all[i];
          var model = c.model ? c.model() : null;
          var mainSeries = model ? model.mainSeries() : null;
          var sym = mainSeries ? mainSeries.symbol() : 'unknown';
          var res = mainSeries ? mainSeries.interval() : null;
          panes.push({ index: i, symbol: sym, resolution: res || null });
        } catch(e) { panes.push({ index: i, error: e.message }); }
      }

      var activeIndex = ${ACTIVE_PANE_INDEX};

      return { layout: layoutType, chart_count: count, active_index: activeIndex < 0 ? null : activeIndex, panes: panes };
    })()
  `);

  return {
    success: true,
    layout: result.layout,
    layout_name: LAYOUT_NAMES[result.layout] || result.layout,
    chart_count: result.chart_count,
    active_index: result.active_index,
    panes: result.panes,
  };
}

/**
 * Set the chart layout grid.
 * @param {string} layout - Layout code: s, 2h, 2v, 2-1, 1-2, 3h, 3v, 4, 6, 8, etc.
 */
export async function setLayout({ layout }: any = {}) {
  const code = requireText(layout, 'layout').toLowerCase().replace(/\s+/g, '');

  const resolved = LAYOUT_ALIASES[code] || code;

  if (!LAYOUT_NAMES[resolved]) {
    const available = Object.entries(LAYOUT_NAMES).map(([k, v]) => `  ${k} — ${v}`).join('\n');
    throw new Error(`Unknown layout "${layout}". Available layouts:\n${available}`);
  }

  await evaluateAsync(`${CWC}.setLayout(${safeString(resolved)})`);
  const { ok, value } = await waitFor<string>(
    `(function() { var t = ${CWC}._layoutType; return (t && typeof t.value === 'function') ? t.value() : t; })()`,
    (current) => current === resolved,
  );
  if (!ok) {
    return { success: false, error: 'Layout did not change', expected: resolved, seen: value ?? null };
  }

  const state = await list();
  return {
    success: true,
    layout: resolved,
    layout_name: LAYOUT_NAMES[resolved],
    chart_count: state.chart_count,
    panes: state.panes,
  };
}

/**
 * Focus a specific pane by index.
 */
export async function focus({ index, _deps }: any = {}) {
  const { evaluate, waitOpts } = _resolve(_deps);
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`Pane index must be a non-negative integer (got ${JSON.stringify(index)})`);
  }
  const result = await evaluate(`
    (function() {
      var cwc = ${CWC};
      var all = cwc.getAll();
      if (${idx} >= all.length) return { error: 'Pane index ' + ${idx} + ' out of range (have ' + all.length + ' panes)' };
      var chart = all[${idx}];
      // Click the main div to activate it
      if (chart._mainDiv) chart._mainDiv.click();
      return { focused: ${idx}, total: all.length };
    })()
  `);

  if (result?.error) throw new Error(result.error);

  const { ok, value } = await waitFor<number>(ACTIVE_PANE_INDEX, (current) => current === idx, waitOpts);
  if (!ok) {
    return { success: false, error: 'Pane did not become active', expected: idx, seen: value ?? null };
  }
  return { success: true, focused_index: result.focused, total_panes: result.total };
}

/**
 * Set the symbol on a specific pane by index.
 * Works by focusing the pane, then using the active chart's setSymbol.
 */
export async function setSymbol({ index, symbol: raw, _deps }: any = {}) {
  const { evaluate, waitOpts } = _resolve(_deps);
  const symbol = requireText(raw, 'symbol');
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`Pane index must be a non-negative integer (got ${JSON.stringify(index)})`);
  }

  // Focus the target pane first
  const focused = await focus({ index: idx, _deps });
  if (!focused.success) return { ...focused, index: idx };

  await evaluate(`window.TradingViewApi._activeChartWidgetWV.value().setSymbol(${safeString(symbol)}, {})`);

  const { ok, value } = await waitFor<string>(
    `${CWC}.getAll()[${idx}].model().mainSeries().symbol()`,
    (current) => symbolMatches(current, symbol),
    waitOpts,
  );
  if (!ok) {
    return { success: false, index: idx, error: 'Pane did not switch to the requested symbol', expected: symbol, seen: value ?? null };
  }
  return { success: true, index: idx, symbol };
}
