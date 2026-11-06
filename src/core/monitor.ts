import { evaluate } from '../connection.js';
import { CHART_API } from './_page.js';

export const directions = ['crossing', 'crossing_up', 'crossing_down'] as const;
export type Direction = typeof directions[number];
export interface WatchOptions {
  kind: 'price_crossing' | 'bar_close';
  price?: number;
  direction?: Direction;
  ttl_ms?: number;
  capacity?: number;
}
export interface Sample {
  identity: string;
  symbol: string;
  resolution: string;
  time: number;
  close: number;
  previous?: { time: number; close: number };
}
export interface WatchEvent {
  cursor: number;
  type: 'price_crossing' | 'bar_close' | 'identity_changed' | 'sampling_gap';
  sampled_at: number;
  time?: number;
  price?: number;
  previous_price?: number;
  direction?: 'crossing_up' | 'crossing_down';
}
interface Watch {
  options: WatchOptions;
  expires: number;
  identity: string;
  symbol: string;
  resolution: string;
  last?: Sample;
  events: WatchEvent[];
  cursor: number;
  stopped: boolean;
}

export const SAMPLE_JS = `(() => {
  const chart = ${CHART_API};
  const widget = chart._chartWidget;
  const bars = widget.model().mainSeries().bars();
  const index = bars.lastIndex();
  const bar = bars.valueAt(index);
  if (!bar) throw new Error('No current bar');
  const previous = bars.valueAt(index - 1);
  const key = '__tvMcpWatchIdentity';
  const state = window[key] || (window[key] = { page: crypto.randomUUID(), widgets: new WeakMap(), next: 0 });
  if (!state.widgets.has(widget)) state.widgets.set(widget, ++state.next);
  return { identity: state.page + ':' + state.widgets.get(widget), symbol: chart.symbol(),
    resolution: chart.resolution(), time: bar[0], close: bar[4],
    previous: previous ? { time: previous[0], close: previous[4] } : undefined };
})()`;

export async function sampleChart(): Promise<Sample> {
  const value: Sample = await evaluate(SAMPLE_JS);
  if (!value || typeof value.identity !== 'string' || !value.identity || typeof value.symbol !== 'string'
    || !value.symbol || typeof value.resolution !== 'string' || !value.resolution
    || !Number.isFinite(value.time) || !Number.isFinite(value.close)
    || (value.previous && (!Number.isFinite(value.previous.time) || !Number.isFinite(value.previous.close)))) {
    throw new Error('Invalid chart sample');
  }
  return value;
}

/** On-call samples only. No timers, CDP listeners, or unbounded event history. */
export class WatchManager {
  private watches = new Map<string, Watch>();
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private sample = sampleChart, private now = Date.now, private maxWatches = 32) {}

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }
  private prune() {
    for (const [id, watch] of this.watches) if (watch.expires <= this.now()) this.watches.delete(id);
  }
  private emit(watch: Watch, event: Omit<WatchEvent, 'cursor' | 'sampled_at'>) {
    watch.events.push({ ...event, cursor: ++watch.cursor, sampled_at: this.now() });
    if (watch.events.length > watch.options.capacity!) watch.events.shift();
  }
  start(options: WatchOptions, signal?: AbortSignal) {
    return this.serial(async () => {
      this.prune();
      if (signal?.aborted) return { success: false, error: 'Aborted' };
      const ttl = options.ttl_ms ?? 300_000;
      const capacity = options.capacity ?? 64;
      if (!['price_crossing', 'bar_close'].includes(options.kind)
        || (options.kind === 'price_crossing' && !Number.isFinite(options.price))
        || (options.direction !== undefined && !directions.includes(options.direction))
        || !Number.isInteger(ttl) || ttl < 1 || ttl > 3_600_000
        || !Number.isInteger(capacity) || capacity < 1 || capacity > 256) {
        return { success: false, error: 'Invalid watch options (ttl_ms 1..3600000, capacity 1..256, finite crossing price)' };
      }
      if (this.closed || this.watches.size >= this.maxWatches) return { success: false, error: 'Watch manager closed or watch limit reached' };
      const baseline = await this.sample();
      if (this.closed || signal?.aborted) return { success: false, error: 'Watch manager closed or aborted' };
      const id = crypto.randomUUID();
      const expires = this.now() + ttl;
      this.watches.set(id, { options: { ...options, capacity }, expires, identity: baseline.identity,
        symbol: baseline.symbol, resolution: baseline.resolution, last: baseline, events: [], cursor: 0, stopped: false });
      return { success: true, watch_id: id, cursor: 0, expires_at_ms: expires, symbol: baseline.symbol,
        resolution: baseline.resolution, sampling: 'on_call', warning: 'Only watch_events samples. Movements between calls can be missed; clients must schedule their own calls.' };
    });
  }
  events(id: string, cursor = 0, signal?: AbortSignal) {
    return this.serial(async () => {
      this.prune();
      const watch = this.watches.get(id);
      if (!watch) return { success: false, error: 'Unknown, expired, or stopped watch' };
      if (!Number.isInteger(cursor) || cursor < 0 || cursor > watch.cursor) return { success: false, error: 'Invalid cursor' };
      if (signal?.aborted) return { success: false, error: 'Aborted' };
      if (!watch.stopped) {
        let current: Sample;
        try { current = await this.sample(); }
        catch (error) {
          watch.last = undefined;
          return { success: false, error: String(error), sampling_loss: true, cursor };
        }
        if (signal?.aborted || this.closed) return { success: false, error: 'Aborted or closed' };
        if (watch.expires <= this.now()) {
          this.watches.delete(id);
          return { success: false, error: 'Watch expired during sample' };
        }
        const last = watch.last;
        if (current.identity !== watch.identity || current.symbol !== watch.symbol || current.resolution !== watch.resolution) {
          this.emit(watch, { type: 'identity_changed' });
          watch.stopped = true;
        } else if (!last || current.time < last.time) {
          this.emit(watch, { type: 'sampling_gap' });
        } else {
          if (watch.options.kind === 'price_crossing') {
            const price = watch.options.price!;
            const direction = last.close <= price && current.close > price ? 'crossing_up'
              : last.close >= price && current.close < price ? 'crossing_down' : undefined;
            if (direction && (!watch.options.direction || watch.options.direction === 'crossing' || watch.options.direction === direction)) {
              this.emit(watch, { type: 'price_crossing', time: current.time, price: current.close, previous_price: last.close, direction });
            }
          } else if (current.time > last.time) {
            if (current.previous?.time === last.time) {
              this.emit(watch, { type: 'bar_close', time: current.previous.time, price: current.previous.close });
            } else this.emit(watch, { type: 'sampling_gap' });
          }
        }
        watch.last = current;
      }
      const oldest = watch.events[0]?.cursor ?? watch.cursor + 1;
      return { success: true, watch_id: id, events: watch.events.filter(event => event.cursor > cursor),
        cursor: watch.cursor, oldest_cursor: oldest, dropped: Math.max(0, oldest - cursor - 1),
        stopped: watch.stopped, sampling: 'on_call', sampling_loss_possible: true };
    });
  }
  stop(id: string) {
    return this.serial(async () => ({ success: true, removed: this.watches.delete(id) }));
  }
  close() { this.closed = true; this.watches.clear(); }
}
