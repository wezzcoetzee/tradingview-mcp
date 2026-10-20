/**
 * Core tab management logic.
 * Controls TradingView Desktop tabs via CDP and Electron keyboard shortcuts.
 */
import { getClient, disconnect, setPreferredTargetId, listTargets, cdpFetch } from '../connection.js';

const TAB_CHANGE_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 250;

/**
 * List all open chart tabs (CDP page targets).
 */
export async function list() {
  const targets = await listTargets();

  const tabs = targets
    .filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    .map((t, i) => ({
      index: i,
      id: t.id,
      title: t.title.replace(/^Live stock.*charts on /, ''),
      url: t.url,
      chart_id: t.url.match(/\/chart\/([^/?]+)/)?.[1] || null,
    }));

  return { success: true, tab_count: tabs.length, tabs };
}

type TabList = Awaited<ReturnType<typeof list>>;

/** Poll the tab list until `done` holds, returning the last list either way. */
async function waitForTabs(done: (tabs: TabList) => boolean): Promise<TabList> {
  const deadline = Date.now() + TAB_CHANGE_TIMEOUT_MS;
  let tabs = await list();
  while (!done(tabs) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    tabs = await list();
  }
  return tabs;
}

/** Press Cmd+<key> on macOS, Ctrl+<key> elsewhere. */
async function pressShortcut(key: string, code: string, windowsVirtualKeyCode: number) {
  const c = await getClient();
  const modifiers = process.platform === 'darwin' ? 4 : 2; // 4 = meta (Cmd), 2 = ctrl
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers, key, code, windowsVirtualKeyCode });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key, code });
}

/**
 * Open a new chart tab via keyboard shortcut (Ctrl+T / Cmd+T).
 */
export async function newTab() {
  const before = await list();
  await pressShortcut('t', 'KeyT', 84);

  const after = await waitForTabs(t => t.tab_count > before.tab_count);
  if (after.tab_count <= before.tab_count) {
    throw new Error(`New tab did not open (tab count stayed at ${before.tab_count})`);
  }
  return { ...after, action: 'new_tab_opened', tabs_before: before.tab_count };
}

/**
 * Close the current tab via keyboard shortcut (Ctrl+W / Cmd+W).
 */
export async function closeTab() {
  const before = await list();
  if (before.tab_count <= 1) {
    throw new Error('Cannot close the last tab. Use tv_launch to restart TradingView instead.');
  }

  await pressShortcut('w', 'KeyW', 87);

  // The cached CDP client points at the now-closed target. Drop it so the
  // next call reconnects to a live tab instead of erroring on a stale handle.
  await disconnect();

  const after = await waitForTabs(t => t.tab_count < before.tab_count);
  if (after.tab_count >= before.tab_count) {
    throw new Error(`Tab did not close (tab count stayed at ${before.tab_count})`);
  }
  return { success: true, action: 'tab_closed', tabs_before: before.tab_count, tabs_after: after.tab_count };
}

/**
 * Switch to a tab by index. Reconnects CDP to the new target.
 */
export async function switchTab({ index }: { index?: unknown } = {}) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error(`Tab index must be a non-negative integer (got ${JSON.stringify(index)})`);
  }

  const tabs = await list();
  if (idx >= tabs.tab_count) {
    throw new Error(`Tab index ${idx} out of range (have ${tabs.tab_count} tabs)`);
  }

  const target = tabs.tabs[idx];
  try {
    await cdpFetch(`/json/activate/${target.id}`);
  } catch (e) {
    throw new Error(`Failed to activate tab ${idx}: ${e instanceof Error ? e.message : String(e)}`);
  }
  setPreferredTargetId(target.id);
  await disconnect();
  return { success: true, action: 'switched', index: idx, tab_id: target.id, chart_id: target.chart_id };
}
