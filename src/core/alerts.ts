/**
 * Core alert logic.
 */
import { evaluate, evaluateAsync, getClient, safeString } from '../connection.js';

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

  await new Promise(r => setTimeout(r, 1000));

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

  await new Promise(r => setTimeout(r, 500));
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

  await new Promise(r => setTimeout(r, 1000));
  const after = await list();
  const created = findNewAlert(before.alerts, after.alerts);

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

export async function deleteAlerts({ delete_all }: any = {}) {
  if (delete_all) {
    const result = await evaluate(`
      (function() {
        var alertBtn = document.querySelector('[data-name="alerts"]');
        if (alertBtn) alertBtn.click();
        var header = document.querySelector('[data-name="alerts"]');
        if (header) {
          header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
          return { context_menu_opened: true };
        }
        return { context_menu_opened: false };
      })()
    `);
    return { success: false, note: 'Alert deletion requires manual confirmation in the TradingView context menu — no alerts were deleted by this call.', context_menu_opened: result?.context_menu_opened || false, source: 'dom_fallback' };
  }
  throw new Error('Individual alert deletion not yet supported. Use delete_all: true.');
}
