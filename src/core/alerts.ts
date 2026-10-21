/**
 * Core alert logic.
 */
import { evaluate, evaluateAsync, getClient, safeString } from '../connection.js';
import { sleep } from './_page.js';

interface AlertSummary { alert_id: string | number }

/** Returns the first alert in `after` whose id is not in `before`. */
export function findNewAlert<T extends AlertSummary>(before: AlertSummary[], after: T[]): T | undefined {
  const known = new Set(before.map(a => a.alert_id));
  return after.find(a => !known.has(a.alert_id));
}

// Every DOM step in create() is scoped to this element so we never touch unrelated page controls.
const ALERT_DIALOG_JS = `(document.querySelector('[data-name="alerts-create-edit-dialog"]')
  || document.querySelector('[role="dialog"][class*="alert"], [role="dialog"][data-name*="alert"]'))`;

async function closeDialog() {
  const client = await getClient();
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}

export async function create({ price, message }: { price: number; message?: string }) {
  const before = await list();
  if (before.error) {
    return { success: false, error: `Cannot verify alert creation, alert list unavailable: ${before.error}` };
  }

  const opened = await evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label="Create Alert"]')
        || document.querySelector('[data-name="alerts"]');
      if (btn) { btn.click(); return true; }
      return false;
    })()
  `);

  if (!opened) {
    const client = await getClient();
    await client.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 1, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA' });
  }

  await sleep(1000);

  const fill = await evaluate(`
    (function() {
      var dialog = ${ALERT_DIALOG_JS};
      if (!dialog) return { dialogFound: false, priceSet: false };
      var inputs = dialog.querySelectorAll('input[type="text"], input[type="number"]');
      var target = null;
      for (var i = 0; i < inputs.length && !target; i++) {
        var label = inputs[i].closest('[class*="row"]')?.querySelector('[class*="label"]');
        if (label && /value|price/i.test(label.textContent)) target = inputs[i];
      }
      target = target || inputs[0];
      if (!target) return { dialogFound: true, priceSet: false };
      var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      nativeSet.call(target, ${safeString(String(price))});
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return { dialogFound: true, priceSet: true };
    })()
  `);

  if (!fill?.dialogFound || !fill.priceSet) {
    if (fill?.dialogFound) await closeDialog();
    return {
      success: false,
      error: fill?.dialogFound ? 'Could not set the price in the alert dialog' : 'Alert dialog not found',
      price_set: false,
    };
  }

  if (message) {
    await evaluate(`
      (function() {
        var dialog = ${ALERT_DIALOG_JS};
        var textarea = dialog && dialog.querySelector('textarea');
        if (textarea) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          nativeSet.call(textarea, ${JSON.stringify(message)});
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
  }

  await sleep(500);
  const submitted = await evaluate(`
    (function() {
      var dialog = ${ALERT_DIALOG_JS};
      if (!dialog) return false;
      var btns = dialog.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (/^create$/i.test(btns[i].textContent.trim())) { btns[i].click(); return true; }
      }
      return false;
    })()
  `);

  if (!submitted) {
    await closeDialog();
    return { success: false, error: 'Create button not found in the alert dialog', price_set: true };
  }

  // The alert list is server-backed, so give it a few seconds to reflect the new alert
  let after = before;
  let created: AlertSummary | undefined;
  for (let i = 0; i < 6 && !created; i++) {
    await sleep(500);
    after = await list();
    created = findNewAlert(before.alerts, after.alerts);
  }

  if (!created) {
    return {
      success: false,
      error: after.error || 'Create was clicked but no new alert appeared in the alert list. Check the condition in the TradingView dialog.',
      price,
      price_set: true,
    };
  }

  return { success: true, price, message: message || '(none)', price_set: true, alert_id: created.alert_id, note: 'Condition must be set manually in the TradingView dialog before clicking Create.', source: 'dom_fallback' };
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
