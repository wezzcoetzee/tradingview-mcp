/**
 * Core UI automation logic.
 */
import { evaluate, evaluateAsync, getClient, safeString } from '../connection.js';

export async function click({ by, value }: any = {}) {
  const escaped = safeString(value);
  const result = await evaluate(`
    (function() {
      var by = ${JSON.stringify(by)};
      var value = ${escaped};
      var el = null;
      var esc = CSS.escape(value);
      if (by === 'aria-label') el = document.querySelector('[aria-label="' + esc + '"]');
      else if (by === 'data-name') el = document.querySelector('[data-name="' + esc + '"]');
      else if (by === 'text') {
        var candidates = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"]');
        for (var i = 0; i < candidates.length; i++) {
          var text = candidates[i].textContent.trim();
          if (text === value || text.toLowerCase() === value.toLowerCase()) { el = candidates[i]; break; }
        }
      } else if (by === 'class-contains') el = document.querySelector('[class*="' + esc + '"]');
      if (!el) return { found: false };
      el.click();
      return { found: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().substring(0, 80), aria_label: el.getAttribute('aria-label') || null, data_name: el.getAttribute('data-name') || null };
    })()
  `);
  if (!result || !result.found) throw new Error('No matching element found for ' + by + '="' + value + '"');
  return { success: true, clicked: result };
}

export async function openPanel({ panel, action }: any = {}) {
  const isBottomPanel = panel === 'pine-editor' || panel === 'strategy-tester';
  if (isBottomPanel) {
    const widgetName = panel === 'pine-editor' ? 'pine-editor' : 'backtesting';
    const result = await evaluate(`
      (function() {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        if (!bwb) return { error: 'bottomWidgetBar not available' };
        var panel = ${JSON.stringify(panel)};
        var widgetName = ${JSON.stringify(widgetName)};
        var action = ${JSON.stringify(action)};
        var bottomArea = document.querySelector('[class*="layout__area--bottom"]');
        var isOpen = !!(bottomArea && bottomArea.offsetHeight > 50);
        if (panel === 'pine-editor') { var monacoEl = document.querySelector('.monaco-editor.pine-editor-monaco'); isOpen = isOpen && !!monacoEl; }
        if (panel === 'strategy-tester') { var stratPanel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]'); isOpen = isOpen && !!(stratPanel && stratPanel.offsetParent); }
        var performed = 'none';
        if (action === 'open' || (action === 'toggle' && !isOpen)) {
          if (panel === 'pine-editor') { if (typeof bwb.activateScriptEditorTab === 'function') bwb.activateScriptEditorTab(); else if (typeof bwb.showWidget === 'function') bwb.showWidget(widgetName); }
          else { if (typeof bwb.showWidget === 'function') bwb.showWidget(widgetName); }
          performed = 'opened';
        } else if (action === 'close' || (action === 'toggle' && isOpen)) {
          if (typeof bwb.hideWidget === 'function') bwb.hideWidget(widgetName);
          performed = 'closed';
        }
        return { was_open: isOpen, performed: performed };
      })()
    `);
    if (result && result.error) throw new Error(result.error);
    return { success: true, panel, action, was_open: result?.was_open ?? false, performed: result?.performed ?? 'unknown' };
  } else {
    const selectorMap = {
      'watchlist': { dataName: 'base-watchlist-widget-button', ariaLabel: 'Watchlist' },
      'alerts': { dataName: 'alerts-button', ariaLabel: 'Alerts' },
      'trading': { dataName: 'trading-button', ariaLabel: 'Trading Panel' },
    };
    const sel = selectorMap[panel];
    const result = await evaluate(`
      (function() {
        var dataName = ${JSON.stringify(sel.dataName)};
        var ariaLabel = ${JSON.stringify(sel.ariaLabel)};
        var action = ${JSON.stringify(action)};
        var btn = document.querySelector('[data-name="' + dataName + '"]') || document.querySelector('[aria-label="' + ariaLabel + '"]');
        if (!btn) return { error: 'Button not found for panel: ' + ${JSON.stringify(panel)} };
        var isActive = btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('isActive') || btn.classList.toString().indexOf('active') !== -1 || btn.classList.toString().indexOf('Active') !== -1;
        var rightArea = document.querySelector('[class*="layout__area--right"]');
        var sidebarOpen = !!(rightArea && rightArea.offsetWidth > 50);
        var isOpen = isActive && sidebarOpen;
        var performed = 'none';
        if (action === 'open' && !isOpen) { btn.click(); performed = 'opened'; }
        else if (action === 'close' && isOpen) { btn.click(); performed = 'closed'; }
        else if (action === 'toggle') { btn.click(); performed = isOpen ? 'closed' : 'opened'; }
        else { performed = isOpen ? 'already_open' : 'already_closed'; }
        return { was_open: isOpen, performed: performed };
      })()
    `);
    if (result && result.error) throw new Error(result.error);
    return { success: true, panel, action, was_open: result?.was_open ?? false, performed: result?.performed ?? 'unknown' };
  }
}

export async function fullscreen() {
  const result = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="header-toolbar-fullscreen"]');
      if (!btn) return { found: false };
      btn.click();
      return { found: true };
    })()
  `);
  if (!result || !result.found) throw new Error('Fullscreen button not found');
  return { success: true, action: 'fullscreen_toggled' };
}

export async function layoutList() {
  const layouts = await evaluateAsync(`
    new Promise(function(resolve) {
      try {
        window.TradingViewApi.getSavedCharts(function(charts) {
          if (!charts || !Array.isArray(charts)) { resolve({layouts: [], source: 'internal_api', error: 'getSavedCharts returned no data'}); return; }
          var result = charts.map(function(c) { return { id: c.id || c.chartId || null, name: c.name || c.title || 'Untitled', symbol: c.symbol || null, resolution: c.resolution || null, modified: c.timestamp || c.modified || null }; });
          resolve({layouts: result, source: 'internal_api'});
        });
        setTimeout(function() { resolve({layouts: [], source: 'internal_api', error: 'getSavedCharts timed out'}); }, 5000);
      } catch(e) { resolve({layouts: [], source: 'internal_api', error: e.message}); }
    })
  `);
  return { success: true, layout_count: layouts?.layouts?.length || 0, source: layouts?.source, layouts: layouts?.layouts || [], error: layouts?.error };
}

export async function layoutSwitch({ name }: any = {}) {
  const escaped = JSON.stringify(name);
  const result = await evaluateAsync(`
    new Promise(function(resolve) {
      try {
        var target = ${escaped};
        if (/^\\d+$/.test(target)) { window.TradingViewApi.loadChartFromServer(target); resolve({success: true, method: 'loadChartFromServer', id: target, source: 'internal_api'}); return; }
        window.TradingViewApi.getSavedCharts(function(charts) {
          if (!charts || !Array.isArray(charts)) { resolve({success: false, error: 'getSavedCharts returned no data', source: 'internal_api'}); return; }
          var match = null;
          for (var i = 0; i < charts.length; i++) { var cname = charts[i].name || charts[i].title || ''; if (cname === target || cname.toLowerCase() === target.toLowerCase()) { match = charts[i]; break; } }
          if (!match) { for (var j = 0; j < charts.length; j++) { var cn = (charts[j].name || charts[j].title || '').toLowerCase(); if (cn.indexOf(target.toLowerCase()) !== -1) { match = charts[j]; break; } } }
          if (!match) { resolve({success: false, error: 'Layout "' + target + '" not found.', source: 'internal_api'}); return; }
          var chartId = match.id || match.chartId;
          window.TradingViewApi.loadChartFromServer(chartId);
          resolve({success: true, method: 'loadChartFromServer', id: chartId, name: match.name || match.title, source: 'internal_api'});
        });
        setTimeout(function() { resolve({success: false, error: 'getSavedCharts timed out', source: 'internal_api'}); }, 5000);
      } catch(e) { resolve({success: false, error: e.message, source: 'internal_api'}); }
    })
  `);
  if (!result?.success) throw new Error(result?.error || 'Unknown error switching layout');

  // Handle "unsaved changes" confirmation dialog
  await new Promise(r => setTimeout(r, 500));
  const dismissed = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/open anyway|don't save|discard/i.test(text)) {
          btns[i].click();
          return true;
        }
      }
      return false;
    })()
  `);

  if (dismissed) await new Promise(r => setTimeout(r, 1000));
  return { success: true, layout: result.name || name, layout_id: result.id, source: result.source, action: 'switched', unsaved_dialog_dismissed: dismissed };
}

const NAMED_KEYS: Record<string, { code: string; vk: number }> = {
  Enter: { code: 'Enter', vk: 13 }, Escape: { code: 'Escape', vk: 27 }, Tab: { code: 'Tab', vk: 9 },
  Backspace: { code: 'Backspace', vk: 8 }, Delete: { code: 'Delete', vk: 46 },
  ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowRight: { code: 'ArrowRight', vk: 39 },
  Space: { code: 'Space', vk: 32 }, ' ': { code: 'Space', vk: 32 },
  Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 }, PageDown: { code: 'PageDown', vk: 34 },
};

type Modifier = 'alt' | 'ctrl' | 'meta' | 'shift';

/** Resolves the DOM `key`, `code`, Windows virtual key code and typed text for a key name. */
export function resolveKey(key: string) {
  const fn = /^F([1-9]|1[0-2])$/.exec(key);
  if (fn) return { key, code: key, vk: 111 + Number(fn[1]), text: undefined };
  const named = NAMED_KEYS[key];
  if (named) {
    const text = key === 'Enter' ? '\r' : named.code === 'Space' ? ' ' : undefined;
    return { key: named.code === 'Space' ? ' ' : key, ...named, text };
  }
  if (/^[a-z]$/i.test(key)) return { key, code: 'Key' + key.toUpperCase(), vk: key.toUpperCase().charCodeAt(0), text: key };
  if (/^[0-9]$/.test(key)) return { key, code: 'Digit' + key, vk: key.charCodeAt(0), text: key };
  throw new Error(`Unsupported key "${key}". Use a letter, digit, F1-F12, or one of: ${Object.keys(NAMED_KEYS).join(', ')}`);
}

/** CDP keyDown/keyUp payloads. Both carry the modifiers; text is only sent for printable keys without ctrl/alt/meta. */
export function keyEvents(key: string, modifiers: Modifier[] = []) {
  const { text, vk, ...rest } = resolveKey(key);
  const flags = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  const mod = modifiers.reduce((acc, m) => acc | flags[m], 0);
  const shortcut = modifiers.some(m => m !== 'shift');
  const base = { ...rest, modifiers: mod, windowsVirtualKeyCode: vk };
  return [
    { type: 'keyDown', ...base, ...(text && !shortcut ? { text } : {}) },
    { type: 'keyUp', ...base },
  ];
}

export async function keyboard({ key, modifiers }: { key: string; modifiers?: Modifier[] }) {
  const c = await getClient();
  for (const event of keyEvents(key, modifiers)) await c.Input.dispatchKeyEvent(event);
  return { success: true, key, modifiers: modifiers || [] };
}

export async function typeText({ text }: any = {}) {
  const c = await getClient();
  await c.Input.insertText({ text });
  return { success: true, typed: text.substring(0, 100), length: text.length };
}

export async function hover({ by, value }: any = {}) {
  const coords = await evaluate(`
    (function() {
      var by = ${JSON.stringify(by)};
      var value = ${safeString(value)};
      var el = null;
      var esc = CSS.escape(value);
      if (by === 'aria-label') {
        el = document.querySelector('[aria-label="' + esc + '"]');
        if (!el) el = document.querySelector('[aria-label*="' + esc + '"]');
      }
      else if (by === 'data-name') el = document.querySelector('[data-name="' + esc + '"]');
      else if (by === 'text') {
        var candidates = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], span, div');
        for (var i = 0; i < candidates.length; i++) { var text = candidates[i].textContent.trim(); if (text === value || text.toLowerCase() === value.toLowerCase()) { el = candidates[i]; break; } }
      } else if (by === 'class-contains') el = document.querySelector('[class*="' + esc + '"]');
      if (!el) return null;
      var rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName.toLowerCase() };
    })()
  `);
  if (!coords) throw new Error('Element not found for ' + by + '="' + value + '"');
  const c = await getClient();
  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: coords.x, y: coords.y });
  return { success: true, hovered: { by, value, tag: coords.tag, x: coords.x, y: coords.y } };
}

export async function scroll({ direction, amount }: any = {}) {
  const c = await getClient();
  const px = amount || 300;
  const center = await evaluate(`
    (function() {
      var el = document.querySelector('[data-name="pane-canvas"]') || document.querySelector('[class*="chart-container"]') || document.querySelector('canvas');
      if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      var rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()
  `);
  let deltaX = 0, deltaY = 0;
  if (direction === 'up') deltaY = -px; else if (direction === 'down') deltaY = px;
  else if (direction === 'left') deltaX = -px; else if (direction === 'right') deltaX = px;
  await c.Input.dispatchMouseEvent({ type: 'mouseWheel', x: center.x, y: center.y, deltaX, deltaY });
  return { success: true, direction, amount: px };
}

/** CDP mouse events for a click; every press and release carries the same clickCount. */
export function clickEvents(x: number, y: number, button: 'left' | 'right' | 'middle', clickCount: number) {
  const buttons = { left: 1, right: 2, middle: 4 }[button];
  return [
    { type: 'mousePressed', x, y, button, buttons, clickCount },
    { type: 'mouseReleased', x, y, button, buttons: 0, clickCount },
  ];
}

export async function mouseClick({ x, y, button, double_click }: any = {}) {
  const c = await getClient();
  const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
  for (const event of clickEvents(x, y, btn, 1)) await c.Input.dispatchMouseEvent(event);
  if (double_click) {
    await new Promise(r => setTimeout(r, 50));
    for (const event of clickEvents(x, y, btn, 2)) await c.Input.dispatchMouseEvent(event);
  }
  return { success: true, x, y, button: btn, double_click: !!double_click };
}

export async function findElement({ query, strategy }: any = {}) {
  const strat = strategy || 'text';
  const results = await evaluate(`
    (function() {
      var query = ${safeString(query)};
      var strategy = ${JSON.stringify(strat)};
      var results = [];
      if (strategy === 'css') {
        var els = document.querySelectorAll(query);
        for (var i = 0; i < Math.min(els.length, 20); i++) {
          var rect = els[i].getBoundingClientRect();
          results.push({ tag: els[i].tagName.toLowerCase(), text: (els[i].textContent || '').trim().substring(0, 80), aria_label: els[i].getAttribute('aria-label') || null, data_name: els[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: els[i].offsetParent !== null });
        }
      } else if (strategy === 'aria-label') {
        var qesc = CSS.escape(query);
        var els = document.querySelectorAll('[aria-label*="' + qesc + '"]');
        for (var i = 0; i < Math.min(els.length, 20); i++) {
          var rect = els[i].getBoundingClientRect();
          results.push({ tag: els[i].tagName.toLowerCase(), text: (els[i].textContent || '').trim().substring(0, 80), aria_label: els[i].getAttribute('aria-label') || null, data_name: els[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: els[i].offsetParent !== null });
        }
      } else {
        var all = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], input, select, label, span, div, h1, h2, h3, h4');
        for (var i = 0; i < all.length; i++) {
          var text = all[i].textContent.trim();
          if (text.toLowerCase().indexOf(query.toLowerCase()) !== -1 && text.length < 200) {
            var rect = all[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({ tag: all[i].tagName.toLowerCase(), text: text.substring(0, 80), aria_label: all[i].getAttribute('aria-label') || null, data_name: all[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: all[i].offsetParent !== null });
              if (results.length >= 20) break;
            }
          }
        }
      }
      return results;
    })()
  `);
  return { success: true, query, strategy: strat, count: results?.length || 0, elements: results || [] };
}

const MAX_EVAL_EXPR_LEN = 2000;

export async function uiEvaluate({ expression }: any = {}) {
  if (process.env.TRADINGVIEW_MCP_ALLOW_EVAL !== '1') {
    throw new Error(
      'ui_evaluate is disabled. This tool runs arbitrary JS inside your logged-in '
      + 'TradingView session — equivalent to handing the model your TradingView account. '
      + 'Set both TRADINGVIEW_MCP_ALLOW_EVAL=1 and TRADINGVIEW_MCP_CONFIRM_EVAL=1 to enable.',
    );
  }
  if (process.env.TRADINGVIEW_MCP_CONFIRM_EVAL !== '1') {
    throw new Error(
      'ui_evaluate requires a second confirmation: set TRADINGVIEW_MCP_CONFIRM_EVAL=1 '
      + 'in addition to TRADINGVIEW_MCP_ALLOW_EVAL=1.',
    );
  }
  if (typeof expression !== 'string' || expression.length === 0) {
    throw new Error('ui_evaluate: expression must be a non-empty string');
  }
  if (expression.length > MAX_EVAL_EXPR_LEN) {
    throw new Error(`ui_evaluate: expression exceeds ${MAX_EVAL_EXPR_LEN} chars`);
  }
  process.stderr.write(`[ui_evaluate] ${new Date().toISOString()} ${JSON.stringify(expression)}\n`);
  const result = await evaluate(expression);
  return { success: true, result };
}
