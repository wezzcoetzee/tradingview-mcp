import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { screenshotDir, screenshotFilename, captureScreenshot } from '../src/core/capture.js';
import { jsonResult } from '../src/tools/_format.js';
import { batchRun } from '../src/core/batch.js';

describe('screenshotFilename', () => {
  const now = new Date('2026-01-02T03:04:05.678Z');

  it('does not double a .png extension', () => {
    assert.equal(screenshotFilename('x.png', 'full', now), 'x.png');
    assert.equal(screenshotFilename('x.PNG', 'full', now), 'x.png');
    assert.equal(screenshotFilename('x', 'full', now), 'x.png');
  });

  it('names a default shot after the region and time', () => {
    assert.equal(screenshotFilename(undefined, 'chart', now), 'tv_chart_2026-01-02T03-04-05-678Z.png');
  });
});

describe('screenshotDir', () => {
  it('defaults to the OS temp dir and honours TV_MCP_SCREENSHOT_DIR', () => {
    const saved = process.env.TV_MCP_SCREENSHOT_DIR;
    delete process.env.TV_MCP_SCREENSHOT_DIR;
    assert.equal(screenshotDir(), join(tmpdir(), 'tradingview-mcp-screenshots'));
    process.env.TV_MCP_SCREENSHOT_DIR = '/custom';
    assert.equal(screenshotDir(), '/custom');
    if (saved === undefined) delete process.env.TV_MCP_SCREENSHOT_DIR;
    else process.env.TV_MCP_SCREENSHOT_DIR = saved;
  });
});

describe('jsonResult images', () => {
  it('returns image_base64 as image content and keeps it out of the text', () => {
    const res = jsonResult({ success: true, file_path: '/a.png', image_base64: 'QUJD' });
    assert.deepEqual(res.content[1], { type: 'image', data: 'QUJD', mimeType: 'image/png' });
    assert.equal((res.content[0] as { text: string }).text.includes('QUJD'), false);
  });
});

describe('batchRun screenshots and progress', () => {
  it('reuses captureScreenshot and reports progress per iteration', async () => {
    const shots: string[] = [];
    const progress: [number, number][] = [];
    const res = await batchRun({
      symbols: ['AAPL', 'MSFT'], timeframes: ['D'], action: 'screenshot', delay_ms: 0,
      onProgress: async (done: number, total: number) => { progress.push([done, total]); },
      _deps: {
        evaluate: async () => null,
        waitForChartReady: async () => ({ ok: true, value: undefined }),
        getChartCollection: async () => 'COL',
        captureScreenshot: (async ({ filename = '' } = {}) => { shots.push(filename); return { file_path: `/tmp/${filename}.png` }; }) as unknown as typeof captureScreenshot,
      },
    });
    assert.equal(res.success, true);
    assert.equal(shots.length, 2);
    assert.match(shots[0]!, /^batch_AAPL_D_/);
    assert.deepEqual(progress, [[1, 2], [2, 2]]);
  });
});
