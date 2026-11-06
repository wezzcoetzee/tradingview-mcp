import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { getStudySeries, getAnalysisSnapshot } from '../src/core/analysis.js';

function fixture() {
  const rawBars = new Map<number, number[]>([
    [10, [100, 1, 3, 0, 2, 20]], [11, [200, 2, 4, 1, 3, 30]], [12, [300, 3, 5, 2, 4, 40]],
  ]);
  const rows = new Map<number, (number | null)[]>([[11, [200, 7, 99, 8]], [12, [300, 9, 99, null]]]);
  const study = {
    id: () => 's1',
    metaInfo: () => ({ description: 'Example', plots: [{ id: 'fast', type: 'line' }, { id: 'color', type: 'colorer' }, { id: 'slow', type: 'line' }], styles: { fast: { title: 'Fast' }, slow: { title: 'Slow' } } }),
    data: (): { valueAt: (i: number) => (number | null)[] | undefined } | null => ({ valueAt: i => rows.get(i) }),
    getInputValues: () => [{ id: 'length', value: 14 }, { id: 'encoded', value: 'x'.repeat(500) }],
    dataWindowView: () => { throw new Error('Crosshair values must never be read'); },
    _graphics: { _primitivesCollection: {
      dwglines: new Map([['lines', new Map([[false, { _primitivesDataById: new Map([[1, { y1: 5, y2: 5 }], [2, { y1: 2, y2: 3 }]]) }]])]]),
      dwglabels: new Map([['labels', new Map([[false, { _primitivesDataById: new Map([[1, { t: 'Level', y: 5 }]]) }]])]]),
      dwgboxes: new Map([['boxes', new Map([[false, { _primitivesDataById: new Map([[1, { y1: 5, y2: 2 }]]) }]])]]),
      dwgtablecells: new Map([['tableCells', new Map([[false, { _primitivesDataById: new Map([[1, { tid: 1, row: 0, col: 0, t: 'Session' }]]) }]])]]),
    } },
  };
  const bars = { firstIndex: () => 10, lastIndex: () => 12, valueAt: (i: number) => rawBars.get(i) };
  const info: Record<string, unknown> = { timezone: 'America/New_York', session: '0930-1600', pricescale: 100, minmov: 1 };
  const main = { bars: () => bars, symbolInfo: () => info };
  const model = { mainSeries: () => main, model: () => ({ dataSources: () => [study] }) };
  let symbol = 'NASDAQ:TEST';
  const api = { symbol: () => symbol, resolution: () => '1W', chartType: () => 8, _chartWidget: { model: () => model } };
  const context = { window: { TradingViewApi: { _activeChartWidgetWV: { value: () => api } } } };
  let calls = 0;
  const deps = { evaluate: async (expression: string) => {
    calls++;
    return JSON.parse(JSON.stringify(runInNewContext(expression, context)));
  } };
  return { deps, rows, rawBars, study, info, bars, api, setSymbol: (s: string) => { symbol = s; }, calls: () => calls };
}

describe('historical study evidence', () => {
  it('executes page code, keeps named plot columns aligned and warmup nulls without reading the crosshair', async () => {
    const f = fixture();
    const result = await getStudySeries({ entity_id: 's1', _deps: f.deps });
    assert.equal(result.success, true);
    assert.deepEqual(result.plots, [{ id: 'fast', name: 'Fast' }, { id: 'slow', name: 'Slow' }]);
    assert.deepEqual(result.rows, [
      { time: 100, values: { fast: null, slow: null } },
      { time: 200, values: { fast: 7, slow: 8 } },
      { time: 300, values: { fast: 9, slow: null } },
    ]);
    assert.deepEqual(result.study?.inputs, [{ id: 'length', value: 14 }]);
    assert.equal(result.symbol, 'NASDAQ:TEST');
    assert.equal(result.resolution, '1W');
    assert.equal(result.chart_type, 8);
    assert.equal(f.calls(), 1);
  });

  it('applies exact names, inclusive ranges and latest count, rejecting invalid bounds before evaluate', async () => {
    const f = fixture();
    const result = await getStudySeries({ entity_id: 's1', plots: ['Fast'], count: 1, from: 100, to: 200, _deps: f.deps });
    assert.deepEqual(result.rows, [{ time: 200, values: { fast: 7 } }]);
    await assert.rejects(getStudySeries({ entity_id: 's1', from: 2, to: 1, _deps: f.deps }), /from/);
    await assert.rejects(getStudySeries({ entity_id: 's1', count: NaN, _deps: f.deps }), /count/);
    await assert.rejects(getStudySeries({ entity_id: 's1', plots: [], _deps: f.deps }), /plots/);
    assert.equal(f.calls(), 1);
  });

  it('caps counts at 500 loaded bars', async () => {
    const f = fixture();
    for (let i = 13; i < 1010; i++) f.rawBars.set(i, [i * 100, 1, 2, 0, 1, 10]);
    f.bars.lastIndex = () => 1009;
    const result = await getStudySeries({ entity_id: 's1', count: 2000, _deps: f.deps });
    assert.equal(result.bar_count, 500);
    assert.equal(result.rows?.[0].time, 51000);
  });

  it('never joins a different timestamp, coerces non-finite values to null and reports unsupported layouts', async () => {
    const f = fixture();
    f.rows.set(11, [199, 77]);
    f.rows.set(12, [300, Infinity, 99, NaN]);
    const result = await getStudySeries({ entity_id: 's1', _deps: f.deps });
    assert.deepEqual(result.rows?.slice(1), [{ time: 200, values: { fast: null, slow: null } }, { time: 300, values: { fast: null, slow: null } }]);
    assert.equal(result.partial, true);
    assert.ok(result.warnings.some(w => w.includes('do not align')));
  });

  it('reports missing data APIs, missing studies, missing plots and empty ranges explicitly', async () => {
    const f = fixture();
    f.study.data = () => null;
    const unsupported = await getStudySeries({ entity_id: 's1', _deps: f.deps });
    assert.equal(unsupported.partial, true);
    assert.ok(unsupported.warnings.some(w => w.includes('unavailable')));
    assert.equal((await getStudySeries({ entity_id: 'missing', _deps: f.deps })).success, false);
    assert.equal((await getStudySeries({ entity_id: 's1', plots: ['missing'], _deps: f.deps })).partial, true);
    const empty = await getStudySeries({ entity_id: 's1', from: 9999, _deps: f.deps });
    assert.equal(empty.bar_count, 0);
    assert.equal(empty.partial, true);
  });
});

describe('analysis snapshots', () => {
  it('bundles requested model evidence with compact price and graphics in a single evaluation', async () => {
    const f = fixture();
    const result = await getAnalysisSnapshot({ _deps: f.deps });
    assert.equal(f.calls(), 1);
    assert.equal(result.consistency, 'single_synchronous_model_evaluation');
    assert.equal(result.partial, true);
    assert.equal(result.sections.studies?.status, 'partial');
    assert.ok(result.warnings.some(w => w.includes('Some latest selected plot values')));
    assert.deepEqual(result.sections.levels?.data, [{ name: 'Example', levels: [5] }]);
    assert.deepEqual(result.sections.labels?.data, [{ name: 'Example', labels: [{ text: 'Level', price: 5 }] }]);
    assert.deepEqual(result.sections.tables?.data, [{ name: 'Example', tables: [{ rows: ['Session'] }] }]);
    assert.deepEqual(result.sections.zones?.data, [{ name: 'Example', zones: [{ high: 5, low: 2 }] }]);
    assert.ok(result.capture_end >= result.capture_start);
  });

  it('keeps feed freshness and weekly candle confirmation unknown despite old bar-open timestamps', async () => {
    const f = fixture();
    const result = await getAnalysisSnapshot({ sections: ['price'], _deps: f.deps });
    assert.deepEqual(Object.keys(result.sections), ['price']);
    assert.equal(result.metadata.bar_timestamp, 300);
    assert.equal(result.metadata.freshness, 'unknown');
    assert.equal(result.metadata.candle_status, 'unknown');
    assert.equal(result.metadata.feed_timestamp, null);
    assert.deepEqual(result.metadata.delay, { status: 'unknown', seconds: null });
    assert.equal(result.metadata.timezone, 'America/New_York');
    assert.equal(result.metadata.min_tick, 0.01);
    f.info.fractional = true;
    assert.equal((await getAnalysisSnapshot({ sections: ['price'], _deps: f.deps })).metadata.min_tick, null);
  });

  it('reports incomplete price and unsupported studies as partial without losing other sections', async () => {
    const f = fixture();
    f.study.data = () => null;
    f.rawBars.clear();
    const result = await getAnalysisSnapshot({ sections: ['price', 'studies', 'levels'], _deps: f.deps });
    assert.equal(result.partial, true);
    assert.equal(result.sections.price?.status, 'unavailable');
    assert.equal(result.sections.studies?.status, 'partial');
    assert.equal(result.sections.levels?.status, 'ok');
  });

  it('caps graphics explicitly and preserves other sections when a graphics reader fails', async () => {
    const f = fixture();
    const labels = f.study._graphics._primitivesCollection.dwglabels.get('labels')?.get(false)?._primitivesDataById;
    assert.ok(labels);
    for (let i = 2; i <= 60; i++) labels.set(i, { t: String(i), y: i });
    const result = await getAnalysisSnapshot({ sections: ['labels', 'price'], _deps: f.deps });
    assert.equal(result.sections.labels?.status, 'partial');
    assert.equal(result.partial, true);
    const labelsData = result.sections.labels?.data as { labels: unknown[] }[];
    assert.equal(labelsData[0].labels.length, 50);
    f.study._graphics._primitivesCollection.dwglines.get = () => { throw new Error('unsupported graphics collection'); };
    const failed = await getAnalysisSnapshot({ sections: ['levels', 'price'], _deps: f.deps });
    assert.equal(failed.sections.levels?.status, 'unavailable');
    assert.ok(failed.sections.levels?.warning?.includes('unsupported graphics collection'));
    assert.equal(failed.sections.price?.status, 'ok');
  });

  it('reports a filter miss and rejects unsupported sections before reading', async () => {
    const f = fixture();
    const result = await getAnalysisSnapshot({ sections: ['studies', 'levels', 'price'], study_filter: 'missing', _deps: f.deps });
    assert.equal(result.sections.studies?.status, 'unavailable');
    assert.equal(result.sections.levels?.status, 'unavailable');
    assert.equal(result.sections.price?.status, 'ok');
    assert.equal(result.partial, true);
    await assert.rejects(getAnalysisSnapshot({ sections: [], _deps: f.deps }), /sections/);
    assert.equal(f.calls(), 1);
  });

  it('retries once after chart identity changes and fails boundedly for repeated changes', async () => {
    const f = fixture();
    let reads = 0;
    f.api.symbol = () => ++reads === 1 ? 'OLD' : 'NEW';
    assert.equal((await getAnalysisSnapshot({ sections: ['price'], _deps: f.deps })).symbol, 'NEW');
    assert.equal(f.calls(), 2);
    f.api.symbol = () => String(++reads);
    await assert.rejects(getAnalysisSnapshot({ sections: ['price'], _deps: f.deps }), /both capture attempts/);
    assert.equal(f.calls(), 4);
  });

  it('detects a changing latest bar and passes evaluate/connection errors through', async () => {
    const f = fixture();
    let n = 0;
    f.bars.valueAt = i => i === 12 ? [300, 3, 5, 2, ++n, 40] : f.rawBars.get(i);
    await assert.rejects(getStudySeries({ entity_id: 's1', _deps: f.deps }), /both capture attempts/);
    await assert.rejects(getAnalysisSnapshot({ _deps: { evaluate: async () => { throw new Error('offline connection failure'); } } }), /offline connection failure/);
  });
});
