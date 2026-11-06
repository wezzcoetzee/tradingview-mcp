import { evaluate, evaluateAsync } from '../connection.js';
import { CHART_API, sleep } from './_page.js';

export interface AlertSummary {
  alert_id: string | number;
  symbol?: string;
  message?: string;
  condition?: unknown;
  frequency?: unknown;
  resolution?: string;
  expiration?: unknown;
}
export const conditions = ['crossing', 'above', 'below', 'crossing_up', 'crossing_down'] as const;
export const frequencies = ['once', 'once_per_bar', 'once_per_bar_close', 'once_per_minute'] as const;
export interface CreateOptions {
  price: number;
  message?: string;
  condition?: typeof conditions[number];
  frequency?: typeof frequencies[number];
  resolution?: string;
  /** Unix seconds. Defaults to 30 days from this call. */
  expiry?: number;
  expected_symbol?: string;
}
export interface AlertRequest {
  price: number;
  message: string;
  condition: typeof conditions[number];
  frequency: typeof frequencies[number];
  resolution: string;
  expiry: number;
  expected_symbol: string;
}
export function findNewAlert<T extends AlertSummary>(before: AlertSummary[], after: T[]): T | undefined {
  const known = new Set(before.map(a => String(a.alert_id)));
  return after.find(a => !known.has(String(a.alert_id)));
}

/** Native, exactly labelled controls only. Unknown/custom layouts fail before any field writes. */
export function configureDialog(request: AlertRequest, submit = false) {
  const dialogs = document.querySelectorAll<HTMLElement>('[data-name="alerts-create-edit-dialog"]');
  if (dialogs.length !== 1) return { ok: false, error: 'Unique alert dialog not found' };
  const dialog = dialogs[0];
  if (request.expiry <= Date.now() / 1000) return { ok: false, error: 'Requested expiration has elapsed' };
  const chart = (window as unknown as { TradingViewApi: { _activeChartWidgetWV: { value(): { symbol(): string; resolution(): string } } } }).TradingViewApi._activeChartWidgetWV.value();
  if (chart.symbol() !== request.expected_symbol || chart.resolution() !== request.resolution) {
    return { ok: false, error: 'Active chart identity changed or requested resolution differs from chart' };
  }
  const labelled = (name: string) => {
    const matches = [...dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')]
      .filter(el => el.getAttribute('aria-label') === name || [...(el.labels || [])].some(label => label.textContent?.trim() === name));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const conditionNames = { crossing: 'Crossing', above: 'Greater Than', below: 'Less Than', crossing_up: 'Crossing Up', crossing_down: 'Crossing Down' };
  const frequencyNames = { once: 'Only Once', once_per_bar: 'Once Per Bar', once_per_bar_close: 'Once Per Bar Close', once_per_minute: 'Once Per Minute' };
  const date = new Date(request.expiry * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const expiry = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}${date.getSeconds() ? ':' + pad(date.getSeconds()) : ''}`;
  const plan: { element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; value: string }[] = [];
  for (const [label, wanted, kind] of [
    ['Symbol', request.expected_symbol, 'select'],
    ['Source', 'Price', 'select'],
    ['Condition', conditionNames[request.condition], 'select'],
    ['Trigger', frequencyNames[request.frequency], 'select'],
    ['Interval', request.resolution, 'select'],
    ['Value', String(request.price), 'input'],
    ['Expiration time', expiry, 'datetime-local'],
    ['Message', request.message, 'textarea'],
  ]) {
    const element = labelled(label);
    if (!element || element.disabled || element.getAttribute('readonly') !== null) return { ok: false, error: `Unavailable exact control: ${label}` };
    let value = wanted;
    if (kind === 'select') {
      if (!(element instanceof HTMLSelectElement)) return { ok: false, error: `Unsupported custom control: ${label}` };
      const options = [...element.options].filter(option => !option.disabled && (option.textContent?.trim() === wanted || (label === 'Interval' && option.value === wanted)));
      if (options.length !== 1) return { ok: false, error: `Unavailable exact option: ${label} = ${wanted}` };
      value = options[0].value;
    } else if (kind === 'textarea' ? !(element instanceof HTMLTextAreaElement)
      : !(element instanceof HTMLInputElement) || (kind === 'datetime-local' ? element.type !== kind : !['text', 'number'].includes(element.type))) {
      return { ok: false, error: `Unsupported control: ${label}` };
    }
    plan.push({ element, value });
  }
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent?.trim() === 'Create' && !button.disabled);
  if (buttons.length !== 1) return { ok: false, error: 'Unique enabled Create button not found' };
  if (!submit) {
    for (const { element, value } of plan) {
      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  if (plan.some(({ element, value }) => element.value !== value || !element.checkValidity())) return { ok: false, error: 'Alert controls did not retain the exact requested values' };
  if (submit) buttons[0].click();
  return { ok: true };
}

export interface CreateIO {
  evaluate: typeof evaluate;
  list: () => Promise<{ alerts: AlertSummary[]; error?: string }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export function verifyCreatedAlert(request: AlertRequest, alert: AlertSummary) {
  const verified: string[] = [];
  const mismatched: string[] = [];
  const unverified = ['condition', 'frequency', 'price'];
  for (const key of ['symbol', 'resolution', 'message', 'expiration'] as const) {
    const expected = key === 'symbol' ? request.expected_symbol : key === 'expiration' ? request.expiry : request[key];
    if (alert[key] === undefined) unverified.push(key);
    else if (alert[key] === expected) verified.push(key);
    else mismatched.push(key);
  }
  return { verified, mismatched, unverified, raw_condition: alert.condition, raw_frequency: alert.frequency };
}

export async function create(options: CreateOptions, deps: Partial<CreateIO> = {}) {
  const io = { evaluate, list, sleep, now: Date.now, ...deps };
  if (!Number.isFinite(options.price) || (options.condition !== undefined && !conditions.includes(options.condition))
    || (options.frequency !== undefined && !frequencies.includes(options.frequency))
    || (options.message !== undefined && typeof options.message !== 'string')
    || (options.resolution !== undefined && !/^(?:[1-9]\d*(?:S|D|W|M)?|D|W|M)$/.test(options.resolution))
    || (options.expiry !== undefined && (!Number.isInteger(options.expiry) || options.expiry <= io.now() / 1000 || options.expiry > 8_640_000_000_000))
    || (options.expected_symbol !== undefined && !options.expected_symbol.trim())) {
    return { success: false, status: 'refused', error: 'Invalid price, condition, frequency, resolution, expiry, message, or expected_symbol' };
  }
  const chart: { symbol: string; resolution: string } = await io.evaluate(`({ symbol: ${CHART_API}.symbol(), resolution: ${CHART_API}.resolution() })`);
  if (!chart?.symbol || !chart.resolution || (options.expected_symbol && options.expected_symbol !== chart.symbol)
    || (options.resolution && options.resolution !== chart.resolution)) return { success: false, status: 'refused', error: 'Expected active symbol/resolution does not match chart' };
  const request: AlertRequest = { price: options.price, message: options.message ?? '', condition: options.condition ?? 'crossing',
    frequency: options.frequency ?? 'once', resolution: options.resolution ?? chart.resolution,
    expiry: options.expiry ?? Math.floor(io.now() / 1000) + 30 * 86400, expected_symbol: chart.symbol };
  const before = await io.list();
  if (before.error) return { success: false, status: 'refused', error: `Cannot verify alert creation: ${before.error}` };
  const opened = await io.evaluate(`(() => {
    if (document.querySelector('[data-name="alerts-create-edit-dialog"]')) return false;
    const buttons = document.querySelectorAll('[aria-label="Create Alert"]');
    if (buttons.length !== 1) return false;
    buttons[0].click(); return true;
  })()`);
  if (!opened) return { success: false, status: 'refused', error: 'Unique Create Alert button unavailable or a dialog is already open' };
  await io.sleep(500);
  const configure = (submit: boolean) => io.evaluate(`(${configureDialog.toString()})(${JSON.stringify(request)}, ${submit})`) as Promise<{ ok: boolean; error?: string }>;
  const filled = await configure(false);
  if (!filled?.ok) return { success: false, status: 'refused', error: filled?.error ?? 'Cannot configure alert dialog', requested: request, submitted: false };
  await io.sleep(250);
  try {
    const submitted = await configure(true);
    if (!submitted?.ok) return { success: false, status: 'refused', error: submitted?.error ?? 'Cannot submit alert dialog', requested: request, submitted: false };
    let after = before;
    for (let attempt = 0; attempt < 6; attempt++) {
      await io.sleep(500);
      after = await io.list();
      if (after.error) continue;
      const candidates = after.alerts.filter(alert => !before.alerts.some(old => String(old.alert_id) === String(alert.alert_id)));
      if (candidates.length > 1) return { success: false, status: 'unverified', submitted: true, error: 'Multiple new alerts; cannot attribute creation. Do not retry automatically.', requested: request };
      if (candidates.length === 1) {
        const alert = candidates[0];
        const verification = verifyCreatedAlert(request, alert);
        return { success: false, status: verification.mismatched.length ? 'mismatch' : 'unverified', submitted: true,
          alert_id: alert.alert_id, requested: request, verification,
          error: 'Alert appeared, but raw list condition/frequency have no verified decoder. Do not retry automatically; inspect alert_list or the dialog.' };
      }
    }
    return { success: false, status: 'unverified', submitted: true, requested: request,
      error: after.error ?? 'No new alert appeared after submission. Do not retry automatically.' };
  } catch (error) {
    return { success: false, status: 'unverified', submission_attempted: true, requested: request,
      error: `Submission or verification failed: ${String(error)}. Do not retry automatically; inspect alert_list.` };
  }
}

export async function list() {
  // Use pricealerts REST API — returns structured data with alert_id, symbol, price, conditions
  const result = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/list_alerts', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.s !== 'ok' || !Array.isArray(data.r)) return { alerts: [], error: data.errmsg || 'Unexpected response' };
        return {
          alerts: data.r.map(function(a) {
            var sym = '';
            try { sym = JSON.parse(a.symbol.replace(/^=/, '')).symbol || a.symbol; } catch(e) { sym = a.symbol; }
            return {
              alert_id: a.alert_id,
              symbol: sym,
              type: a.type,
              message: a.message,
              active: a.active,
              condition: a.condition,
              resolution: a.resolution,
              frequency: a.frequency,
              created: a.create_time,
              last_fired: a.last_fire_time,
              expiration: a.expiration,
            };
          })
        };
      })
      .catch(function(e) { return { alerts: [], error: e.message }; })
  `);
  return { success: true, alert_count: result?.alerts?.length || 0, source: 'internal_api', alerts: (result?.alerts || []) as AlertSummary[], error: result?.error as string | undefined };
}

type AlertId = string | number;

export interface DeleteIO {
  list: () => Promise<{ alerts: AlertSummary[]; error?: string }>;
  post: (ids: AlertId[]) => Promise<{ ok: boolean; error?: string }>;
}

// Endpoint shape inferred, not yet verified against a live account.
async function postDeleteAlerts(ids: AlertId[]) {
  const result = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/delete_alerts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { alert_ids: ${JSON.stringify(ids)} } }),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) { return { ok: data.s === 'ok', error: data.s === 'ok' ? undefined : (data.errmsg || 'Unexpected response') }; })
      .catch(function(e) { return { ok: false, error: e.message }; })
  `);
  return { ok: !!result?.ok, error: result?.error as string | undefined };
}

/** Deletes alerts by id (or all of them) and confirms by re-listing that they are gone. */
export async function deleteAlerts(
  { alert_id, delete_all }: { alert_id?: AlertId | AlertId[]; delete_all?: boolean } = {},
  io: DeleteIO = { list, post: postDeleteAlerts },
) {
  const requested = alert_id === undefined ? [] : [alert_id].flat();
  if (delete_all && requested.length) {
    return { success: false, error: 'Pass either alert_id or delete_all, not both' };
  }
  if (!delete_all && !requested.length) {
    return { success: false, error: 'Pass alert_id (one or more) or delete_all: true' };
  }

  const before = await io.list();
  if (before.error) return { success: false, error: `Cannot delete alerts, alert list unavailable: ${before.error}` };

  const targets = delete_all
    ? before.alerts.map(a => a.alert_id)
    : before.alerts.map(a => a.alert_id).filter(id => requested.some(r => String(r) === String(id)));
  const not_found = requested.filter(r => !targets.some(id => String(id) === String(r)));
  if (not_found.length) return { success: false, error: 'Alert id not found in alert_list', not_found };
  if (!targets.length) return { success: true, deleted: [], deleted_count: 0, source: 'internal_api' };

  const posted = await io.post(targets);
  if (!posted.ok) return { success: false, error: `Delete request failed: ${posted.error}`, requested: targets };

  const after = await io.list();
  if (after.error) return { success: false, error: `Delete sent but could not verify: ${after.error}`, requested: targets };
  const remaining = targets.filter(id => after.alerts.some(a => String(a.alert_id) === String(id)));
  if (remaining.length) {
    return { success: false, error: 'Delete was sent but some alerts are still in alert_list', remaining };
  }
  return { success: true, deleted: targets, deleted_count: targets.length, source: 'internal_api' };
}
