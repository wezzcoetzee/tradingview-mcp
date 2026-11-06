import { evaluate, requireFinite, requireText } from '../connection.js';
import { CHART_API, type WithDeps } from './_page.js';
import { buildGraphicsJS, boxZones, horizontalLevels, tableRows, summarizeBars, type readGraphics } from './data.js';

export const ANALYSIS_SECTIONS = ['price', 'studies', 'levels', 'labels', 'tables', 'zones'] as const;
export type AnalysisSection = typeof ANALYSIS_SECTIONS[number];
interface Bounds { count?: number; from?: number; to?: number }
export interface StudySeriesParams extends Bounds, WithDeps {
  entity_id: string;
  plots?: string[];
}
export interface AnalysisSnapshotParams extends WithDeps {
  count?: number;
  sections?: AnalysisSection[];
  study_filter?: string;
}
type Bar = Parameters<typeof summarizeBars>[0][number];
type LoadedBar = { [K in keyof Bar]: K extends 'time' ? number : number | null };
interface Plot { id: string; name: string }
interface Study {
  entity_id: string; name: string; plots: Plot[];
  inputs: unknown;
  rows: { time: number; values: Record<string, number | null> }[];
  warnings: string[];
}
type Graphics = Awaited<ReturnType<typeof readGraphics>>['studies'];
interface Evidence {
  changed?: boolean;
  symbol: string; resolution: string; chart_type: number;
  capture_start: string; capture_end: string;
  metadata: {
    bar_timestamp: number | null;
    capture_timestamp: string;
    freshness: 'unknown'; quote_timestamp: null; feed_timestamp: null;
    delay: { status: 'unknown'; seconds: null };
    candle_status: 'unknown'; timezone: string | null; session: string | null;
    min_tick: number | null; pricescale: number | null; minmov: number | null;
  };
  bars: LoadedBar[]; studies: Study[]; warnings: string[];
  graphics: Partial<Record<AnalysisSection, Graphics>>;
  failures: Partial<Record<AnalysisSection, string>>;
}

function bounds({ count, from, to }: Bounds) {
  const limit = Math.min(500, Math.max(1, Math.floor(requireFinite(count ?? 100, 'count'))));
  const start = from === undefined ? null : requireFinite(from, 'from');
  const end = to === undefined ? null : requireFinite(to, 'to');
  if (start !== null && end !== null && start > end) throw new Error('from must not be after to');
  return { limit, start, end };
}

function evidenceExpression(options: Bounds & { entity_id?: string; plots?: string[]; sections: readonly AnalysisSection[]; study_filter?: string }) {
  const { limit, start, end } = bounds(options);
  const config = JSON.stringify({ ...options, limit, start, end });
  const collections = { levels: ['dwglines', 'lines'], labels: ['dwglabels', 'labels'], tables: ['dwgtablecells', 'tableCells'], zones: ['dwgboxes', 'boxes'] };
  const graphics = Object.entries(collections).filter(([section]) => options.sections.includes(section as AnalysisSection)).map(([section, [collection, key]]) => `
    try { var graphics = (${buildGraphicsJS(collection, key, options.study_filter)}); result.graphics.${section} = graphics.studies; if (graphics.errors.length) result.failures.${section} = graphics.errors.join('; '); if (config.study_filter && !graphics.available.some(function(name) { return name.toLowerCase().indexOf(config.study_filter.toLowerCase()) >= 0; })) result.failures.${section} = 'No studies match the requested filter.'; }
    catch (e) { result.failures.${section} = String(e); }
  `).join('\n');
  return `(function() {
    var config = ${config};
    var started = new Date().toISOString();
    var api = ${CHART_API};
    var model = api._chartWidget.model();
    var main = model.mainSeries();
    var bars = main.bars();
    function identity() { return JSON.stringify([api.symbol(), api.resolution(), api.chartType(), bars.firstIndex(), bars.lastIndex(), bars.valueAt(bars.lastIndex())]); }
    var before = identity();
    var info = {};
    try { info = main.symbolInfo() || {}; } catch (e) {}
    function numeric(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
    var result = {
      symbol: api.symbol(), resolution: api.resolution(), chart_type: api.chartType(),
      capture_start: started, capture_end: null, bars: [], studies: [], graphics: {}, failures: {},
      warnings: ['Only loaded chart data is read. Feed freshness, delay and candle confirmation are unknown.'],
      metadata: {
        capture_timestamp: started, bar_timestamp: null, freshness: 'unknown',
        quote_timestamp: null, feed_timestamp: null, delay: {status: 'unknown', seconds: null}, candle_status: 'unknown',
        timezone: typeof info.timezone === 'string' ? info.timezone : null,
        session: typeof info.session === 'string' ? info.session : null,
        pricescale: numeric(info.pricescale), minmov: numeric(info.minmov),
        min_tick: numeric(info.minmov) !== null && info.minmov > 0 && numeric(info.pricescale) !== null && info.pricescale > 0 && !info.minmove2 && !info.fractional && !info.variable_tick_size ? info.minmov / info.pricescale : null
      }
    };
    var latest = bars.valueAt(bars.lastIndex());
    result.metadata.bar_timestamp = latest ? numeric(latest[0]) : null;
    var indexed = [];
    for (var i = bars.lastIndex(), first = bars.firstIndex(); i >= first && indexed.length < config.limit; i--) {
      var v = bars.valueAt(i);
      if (!v || numeric(v[0]) === null) continue;
      if (config.end !== null && v[0] > config.end) continue;
      if (config.start !== null && v[0] < config.start) break;
      indexed.push({index: i, value: v});
    }
    indexed.reverse();
    result.bars = indexed.map(function(b) { var v = b.value; return {time: v[0], open: numeric(v[1]), high: numeric(v[2]), low: numeric(v[3]), close: numeric(v[4]), volume: numeric(v[5])}; });
    if (config.sections.indexOf('studies') >= 0) {
      var sources = model.model().dataSources();
      for (var s of sources) {
        if (!s || typeof s.metaInfo !== 'function') continue;
        var id = typeof s.id === 'function' ? s.id() : s.id;
        if (config.entity_id !== undefined && id !== config.entity_id) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (config.study_filter && name.toLowerCase().indexOf(config.study_filter.toLowerCase()) < 0) continue;
          var study = {entity_id: id, name: name, inputs: null, plots: [], rows: [], warnings: []};
          var selected = (meta.plots || []).map(function(p, n) { return {id: p.id, name: (meta.styles && meta.styles[p.id] && meta.styles[p.id].title) || p.id, type: p.type, column: n + 1}; }).filter(function(p) {
            return p.type === 'line' && (!config.plots || config.plots.indexOf(p.id) >= 0 || config.plots.indexOf(p.name) >= 0);
          });
          study.plots = selected.map(function(p) { return {id: p.id, name: p.name}; });
          if (!indexed.length) study.warnings.push('No underlying loaded bars in the requested range.');
          if (!selected.length) study.warnings.push('No matching numeric line plots with a supported layout.');
          if (config.plots && config.plots.some(function(p) { return !selected.some(function(s) { return s.id === p || s.name === p; }); })) study.warnings.push('Some requested plots are missing or unsupported.');
          try {
            var inputs = s.getInputValues();
            if (Array.isArray(inputs)) study.inputs = inputs.filter(function(input) { return input && typeof input.id === 'string' && (typeof input.value === 'number' || typeof input.value === 'boolean' || (typeof input.value === 'string' && input.value.length <= 200)); }).slice(0, 50);
          } catch (e) {}
          var data = null;
          try { data = s.data(); } catch (e) {}
          if (!data || typeof data.valueAt !== 'function') study.warnings.push('Historical study data().valueAt is unavailable.');
          var misaligned = false;
          study.rows = indexed.map(function(b) {
            var row = data && typeof data.valueAt === 'function' ? data.valueAt(b.index) : null;
            // Never join nearest rows or accept a different timestamp as historical evidence.
            var aligned = Array.isArray(row) && row[0] === b.value[0];
            if (row && !aligned) misaligned = true;
            var values = Object.create(null);
            selected.forEach(function(p) { values[p.id] = aligned ? numeric(row[p.column]) : null; });
            return {time: b.value[0], values: values};
          });
          if (study.rows.length && selected.length && Object.values(study.rows[study.rows.length - 1].values).some(function(v) { return v === null; })) study.warnings.push('Some latest selected plot values are unavailable or warming up.');
          if (misaligned) study.warnings.push('Study row layout/timestamps do not align with underlying bars; affected values are null.');
          result.studies.push(study);
        } catch (e) { result.failures.studies = 'A study could not be read: ' + String(e); }
      }
      if (config.study_filter && !result.studies.length && !result.failures.studies) result.failures.studies = 'No studies match the requested filter.';
    }
    ${graphics}
    result.changed = ${CHART_API} !== api || api._chartWidget.model() !== model || model.mainSeries() !== main || main.bars() !== bars || before !== identity();
    result.capture_end = new Date().toISOString();
    return result;
  })()`;
}

async function readEvidence(options: Parameters<typeof evidenceExpression>[0], deps?: WithDeps['_deps']): Promise<Evidence> {
  const ev = deps?.evaluate ?? evaluate;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result: Evidence | null = await ev(evidenceExpression(options));
    if (!result) throw new Error('Chart evidence is unavailable');
    if (!result.changed) return result;
  }
  throw new Error('Chart identity or latest bar changed during both capture attempts; retry when settled');
}

export async function getStudySeries({ entity_id, plots, count, from, to, _deps }: StudySeriesParams) {
  const id = requireText(entity_id, 'entity_id');
  if (plots && (!plots.length || plots.some(p => !p.trim()))) throw new Error('plots must contain non-empty plot IDs or names');
  const result = await readEvidence({ entity_id: id, plots, count, from, to, sections: ['studies'] }, _deps);
  const study = result.studies.find(s => s.entity_id === id);
  const warnings = [...result.warnings, ...Object.values(result.failures), ...(study?.warnings ?? [])];
  if (!study) return { success: false, error: 'Study not found or unreadable; use chart_get_state for entity IDs', ...context(result), warnings, partial: true, study: null, plots: [], rows: [], bar_count: 0 };
  if (!result.bars.length) warnings.push('No loaded bars in the requested range.');
  return { success: true, ...context(result), source: 'study_model_timestamp_aligned', partial: warnings.length > result.warnings.length, study: { entity_id: study.entity_id, name: study.name, inputs: study.inputs }, plots: study.plots, bar_count: study.rows.length, rows: study.rows, warnings };
}

function context(result: Evidence) {
  return { symbol: result.symbol, resolution: result.resolution, chart_type: result.chart_type, capture_start: result.capture_start, capture_end: result.capture_end, metadata: result.metadata };
}

export async function getAnalysisSnapshot({ count = 100, sections = [...ANALYSIS_SECTIONS], study_filter, _deps }: AnalysisSnapshotParams = {}) {
  if (!sections.length || sections.some(s => !ANALYSIS_SECTIONS.includes(s))) throw new Error('sections must contain supported analysis sections');
  const requested = [...new Set(sections)];
  const result = await readEvidence({ count, sections: requested, study_filter }, _deps);
  const warnings = [...result.warnings];
  const output: Partial<Record<AnalysisSection, { status: 'ok' | 'partial' | 'unavailable'; data: unknown; warning?: string }>> = {};
  for (const section of requested) {
    const failure = result.failures[section];
    if (failure) warnings.push(failure);
    if (section === 'price') {
      const bars = result.bars.filter((b): b is Bar => [b.open, b.high, b.low, b.close, b.volume].every(v => typeof v === 'number' && Number.isFinite(v)));
      const valid = bars.length > 0 && bars.length === result.bars.length;
      output.price = valid ? { status: 'ok', data: summarizeBars(bars) } : { status: 'unavailable', data: null, warning: 'Loaded OHLCV is empty or incomplete.' };
    } else if (section === 'studies') {
      const partial = result.studies.some(s => s.warnings.length > 0);
      output.studies = { status: partial ? 'partial' : 'ok', data: result.studies.map(s => ({ ...s, rows: s.rows.slice(-1) })) };
      warnings.push(...result.studies.flatMap(s => s.warnings));
    } else {
      const studies = result.graphics[section] ?? [];
      const truncated = studies.some(s => s.items.length > (section === 'tables' ? 200 : 50));
      const data = studies.map(s => {
        const items = s.items.slice(-(section === 'tables' ? 200 : 50));
        if (section === 'levels') return { name: s.name, levels: horizontalLevels(items) };
        if (section === 'zones') return { name: s.name, zones: boxZones(items) };
        if (section === 'tables') return { name: s.name, tables: tableRows(items) };
        return { name: s.name, labels: items.map(({ raw }) => ({ text: raw.t ?? '', price: raw.y ?? null })) };
      });
      output[section] = { status: truncated ? 'partial' : 'ok', data, ...(truncated && { warning: 'Graphics capped per study (50 items; 200 table cells).' }) };
    }
    if (failure) {
      const item = output[section];
      if (item) {
        item.status = Array.isArray(item.data) && item.data.length > 0 ? 'partial' : 'unavailable';
        item.warning = failure;
      }
    }
  }
  if (study_filter && !result.studies.length && !Object.values(result.graphics).some(s => s?.length)) warnings.push('No studies or graphics matched the filter in the requested sections.');
  const partial = Object.values(output).some(s => s.status !== 'ok');
  return { success: true, ...context(result), consistency: 'single_synchronous_model_evaluation', requested_sections: requested, partial, sections: output, warnings };
}
