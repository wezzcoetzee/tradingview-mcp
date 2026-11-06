export function pageFixture(size = 10) {
  const state = { symbol: 'EX:ORIGINAL', timeframe: '60', visible: { from: 2, to: 8 }, restoreFails: false, grow: false, noNavigation: false, noBars: false, switchesFail: false, changedDuringRead: false };
  const rows = new Map<number, number[]>(Array.from({ length: size }, (_, i) => [i, [i * 60, 10, 12, 9, 11, 100]]));
  const calls: string[] = [];
  const bars = { firstIndex: () => Math.min(...rows.keys()), lastIndex: () => Math.max(...rows.keys()), valueAt: (i: number) => rows.get(i), size: () => rows.size };
  const primitive = { y1: 100, y2: 100, t: 'Level', y: 100, tid: 1, row: 0, col: 0 };
  const collection = () => new Map([[false, { _primitivesDataById: new Map([[1, primitive], [2, { ...primitive, y1: 200, y2: 200 }]]) }]]);
  const studies = ['Alpha', 'Beta'].map(name => ({
    id: () => name, metaInfo: () => ({ description: name }),
    dataWindowView: () => ({ items: () => [{ _title: 'Value', _value: '123' }] }),
    _graphics: { _primitivesCollection: {
      dwglines: new Map([['lines', collection()]]), dwglabels: new Map([['labels', collection()]]),
      dwgboxes: new Map([['boxes', collection()]]), dwgtablecells: new Map([['tableCells', collection()]]),
    } },
  }));
  const chart = {
    symbol: () => state.symbol, resolution: () => state.timeframe,
    getVisibleBarsRange: () => state.visible,
    setSymbol: (s: string) => { if (!state.switchesFail) state.symbol = s; },
    setResolution: (tf: string) => { state.timeframe = tf; },
    _chartWidget: { model: () => ({
      mainSeries: () => ({ bars: () => state.noBars ? null : bars }),
      model: () => ({ dataSources: () => {
        if (state.changedDuringRead) state.symbol = 'WRONG';
        return studies;
      } }),
      timeScale: () => state.noNavigation ? {} : ({ zoomToBarsRange: (from: number, to: number) => {
        if (from === 2 && to === 8 && state.restoreFails) throw new Error('restore failed');
        state.visible = { from, to };
        if (from < 0 && state.grow) for (let i = bars.firstIndex() - 5, end = bars.firstIndex(); i < end; i++) rows.set(i, [i * 60, 10, 12, 9, 11, 100]);
      } }),
    }) },
  };
  const window = { TradingViewApi: { _activeChartWidgetWV: { value: () => chart } } };
  const evaluate = async (expression: string) => {
    calls.push(expression);
    return new Function('window', 'COL', `return (${expression})`)(window, chart);
  };
  const deps = {
    evaluate,
    getChartCollection: async () => 'COL',
    waitForChartReady: async () => ({ ok: true, value: undefined }),
  };
  return { state, rows, deps, calls };
}
