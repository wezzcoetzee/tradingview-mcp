/**
 * Core screenshot/capture logic.
 */
import { getClient, evaluate, getChartCollection } from '../connection.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export const CAPTURE_REGIONS = ['full', 'chart', 'strategy_tester'] as const;
export const CAPTURE_METHODS = ['cdp', 'api'] as const;
export type CaptureRegion = (typeof CAPTURE_REGIONS)[number];
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/** Where screenshots are written: TV_MCP_SCREENSHOT_DIR, else a folder in the OS temp dir. */
export function screenshotDir(): string {
  return process.env.TV_MCP_SCREENSHOT_DIR || join(tmpdir(), 'tradingview-mcp-screenshots');
}

export function sanitizeFilename(name) {
  let s = String(name).replace(/[^\w.-]/g, '_').slice(0, 80);
  if (s.startsWith('.') || s.length === 0) s = '_' + s;
  return s;
}

/** File name with a single .png extension, whether or not the caller included one. */
export function screenshotFilename(filename: string | undefined, region: CaptureRegion, now = new Date()): string {
  const base = filename?.replace(/\.png$/i, '') || `tv_${region}_${now.toISOString().replace(/[:.]/g, '-')}`;
  return `${sanitizeFilename(base)}.png`;
}

interface CaptureOptions {
  region?: CaptureRegion;
  filename?: string;
  method?: CaptureMethod;
  /** Also return the PNG as base64 (image_base64) for clients that cannot read the saved file. */
  inline?: boolean;
}

export async function captureScreenshot({ region = 'full', filename, method, inline }: CaptureOptions = {}) {
  const dir = screenshotDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, screenshotFilename(filename, region));

  if (method === 'api') {
    try {
      const colPath = await getChartCollection();
      await evaluate(`${colPath}.takeScreenshot()`);
      return {
        success: true, method: 'api',
        note: 'takeScreenshot() triggered — TradingView will save/show the screenshot via its own UI',
      };
    } catch {
      // Fall through to CDP method
    }
  }

  const client = await getClient();
  let clip = undefined;
  let captured: CaptureRegion = region;

  if (region === 'chart') {
    const bounds = await evaluate(`
      (function() {
        var el = document.querySelector('[data-name="pane-canvas"]')
          || document.querySelector('[class*="chart-container"]')
          || document.querySelector('canvas');
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  } else if (region === 'strategy_tester') {
    const bounds = await evaluate(`
      (function() {
        var el = document.querySelector('[data-name="backtesting"]')
          || document.querySelector('[class*="strategyReport"]');
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  }

  // The element was not found: the full window is captured instead, and the result says so.
  if (region !== 'full' && !clip) captured = 'full';

  const { data } = await client.Page.captureScreenshot({ format: 'png', ...(clip && { clip }) });
  const png = Buffer.from(data, 'base64');
  writeFileSync(filePath, png);

  return {
    success: true, method: 'cdp', file_path: filePath, region: captured,
    ...(captured !== region && { region_fallback: true, requested_region: region }),
    size_bytes: png.length,
    ...(inline && { image_base64: data }),
  };
}
