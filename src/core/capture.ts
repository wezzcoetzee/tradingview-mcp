/**
 * Core screenshot/capture logic.
 */
import { getClient, evaluate, evaluateAsync, KNOWN_PATHS } from '../connection.js';
import { hiddenWindowNote } from './_page.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export const CAPTURE_REGIONS = ['full', 'chart', 'strategy_tester'] as const;
export const CAPTURE_METHODS = ['cdp', 'snapshot'] as const;
export type CaptureRegion = (typeof CAPTURE_REGIONS)[number];
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/** Where screenshots are written: TV_MCP_SCREENSHOT_DIR, else a folder in the OS temp dir. */
export function screenshotDir(): string {
  return process.env.TV_MCP_SCREENSHOT_DIR || join(tmpdir(), 'tradingview-mcp-screenshots');
}

export function sanitizeFilename(name: unknown) {
  let s = String(name).replace(/[^\w.-]/g, '_').slice(0, 80);
  if (s.startsWith('.') || s.length === 0) s = '_' + s;
  return s;
}

/** File name with a single .png extension, whether or not the caller included one. */
export function screenshotFilename(filename: string | undefined, region: CaptureRegion, now = new Date()): string {
  const base = filename?.replace(/\.png$/i, '') || `tv_${region}_${now.toISOString().replace(/[:.]/g, '-')}`;
  return `${sanitizeFilename(base)}.png`;
}

/**
 * A hidden window (screen locked, minimized) stops repainting its DOM, so CDP pixels mix a fresh
 * canvas with a stale legend. The snapshot renders the chart from its model and stays correct.
 * The Strategy Tester has no model render, so it always uses CDP.
 */
export function pickCaptureMethod(requested: CaptureMethod | undefined, region: CaptureRegion, hidden: boolean): CaptureMethod {
  if (requested) return requested;
  return hidden && region !== 'strategy_tester' ? 'snapshot' : 'cdp';
}

/** TradingView's own chart render (what "Copy chart image" uses): every pane with its legend and drawings. */
const CLIENT_SNAPSHOT_PNG = `(async function() {
  var canvas = await ${KNOWN_PATHS.chartWidgetCollection}.clientSnapshot();
  return canvas.toDataURL('image/png').split(',')[1];
})()`;

const REGION_SELECTORS: Partial<Record<CaptureRegion, string[]>> = {
  chart: ['[data-name="pane-canvas"]', '[class*="chart-container"]', 'canvas'],
  strategy_tester: ['[data-name="backtesting"]', '[class*="strategyReport"]'],
};

/** Capture the window with CDP, clipped to the region when its element is found, else the full window. */
async function cdpCapture(region: CaptureRegion): Promise<{ data: string; region: CaptureRegion }> {
  const selectors = REGION_SELECTORS[region];
  const bounds = selectors && await evaluate(`
    (function() {
      var el = ${selectors.map(s => `document.querySelector(${JSON.stringify(s)})`).join(' || ')};
      if (!el) return null;
      var rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()
  `);
  const client = await getClient();
  const { data } = await client.Page.captureScreenshot({ format: 'png', ...(bounds && { clip: { ...bounds, scale: 1 } }) });
  return { data, region: bounds ? region : 'full' };
}

interface CaptureOptions {
  region?: CaptureRegion;
  filename?: string;
  /** Defaults to snapshot while the window is hidden, cdp otherwise (see pickCaptureMethod). */
  method?: CaptureMethod;
  /** Also return the PNG as base64 (image_base64) for clients that cannot read the saved file. */
  inline?: boolean;
}

export async function captureScreenshot({ region = 'full', filename, method, inline }: CaptureOptions = {}) {
  const dir = screenshotDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, screenshotFilename(filename, region));

  const hidden: boolean = await evaluate('document.hidden');
  const used = pickCaptureMethod(method, region, hidden);
  const shot = used === 'snapshot'
    ? { data: await evaluateAsync(CLIENT_SNAPSHOT_PNG) as string, region: 'chart' as const }
    : await cdpCapture(region);

  const png = Buffer.from(shot.data, 'base64');
  writeFileSync(filePath, png);

  return {
    success: true, method: used, file_path: filePath, region: shot.region,
    ...(shot.region !== region && { region_fallback: true, requested_region: region }),
    size_bytes: png.length,
    ...(used === 'cdp' ? hiddenWindowNote(hidden) : hidden && { window_hidden: true }),
    ...(inline && { image_base64: shot.data }),
  };
}
