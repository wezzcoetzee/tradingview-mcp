import { afterEach, describe, it, mock } from 'bun:test';
import assert from 'node:assert/strict';
import * as connection from '../src/connection.js';
import { switchTab } from '../src/core/tab.js';
import { debug, isDebugEnabled } from '../src/debug.js';

describe('connection — CDP lifecycle', () => {
  const realFetch = globalThis.fetch;
  const stubFetch = (handler: (url: string) => Response) => {
    const fn = mock(async (input: string | URL | Request) => handler(String(input)));
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
  };
  afterEach(() => { globalThis.fetch = realFetch; });

  it('treats connection-refused as fatal and everything else as transient', () => {
    assert.equal(connection.isTransientError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), false);
    assert.equal(connection.isTransientError(Object.assign(new Error('x'), { code: 'ConnectionRefused' })), false);
    assert.equal(connection.isTransientError(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })), false);
    assert.equal(connection.isTransientError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true);
    assert.equal(connection.isTransientError(new Error('CDP connect timed out after 5000ms')), true);
  });

  it('fails fast without retrying when nothing listens on the port', async () => {
    const fetchMock = stubFetch(() => { throw Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' }); });
    const started = Date.now();
    await assert.rejects(connection.connect(), /Cannot reach TradingView at http:\/\/127\.0\.0\.1:\d+/);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.ok(Date.now() - started < 400);
  });

  it('shares one validated port setting', () => {
    const original = connection.getCdpPort();
    try {
      connection.setCdpPort(9333);
      assert.equal(connection.getCdpPort(), 9333);
      assert.equal(connection.cdpBaseUrl(), 'http://127.0.0.1:9333');
      assert.throws(() => connection.setCdpPort(0), /Invalid CDP port/);
      assert.throws(() => connection.parseCdpPort('abc'), /Invalid CDP port/);
      assert.equal(connection.parseCdpPort('9444'), 9444);
    } finally {
      connection.setCdpPort(original);
    }
  });

  it('cdpFetch rejects non-2xx responses', async () => {
    stubFetch(() => new Response('nope', { status: 404 }));
    await assert.rejects(connection.cdpFetch('/json/list'), /HTTP 404/);
  });

  it('pickChartTarget prefers the chosen tab, then chart pages, and ignores non-pages', () => {
    const t = (id: string, url: string, type = 'page') => ({ id, url, type, title: id });
    const targets = [
      t('worker', 'https://www.tradingview.com/chart/abc', 'service_worker'),
      t('home', 'https://www.tradingview.com/'),
      t('chart1', 'https://www.tradingview.com/chart/abc'),
      t('chart2', 'https://www.tradingview.com/chart/def'),
    ];
    assert.equal(connection.pickChartTarget(targets, 'chart2')?.id, 'chart2');
    assert.equal(connection.pickChartTarget(targets, 'worker')?.id, 'chart1');
    assert.equal(connection.pickChartTarget(targets, null)?.id, 'chart1');
    assert.equal(connection.pickChartTarget([targets[1]], null)?.id, 'home');
    assert.equal(connection.pickChartTarget([], null), null);
  });

  it('tab_switch reports a failed /json/activate', async () => {
    stubFetch((url) => url.endsWith('/json/list')
      ? Response.json([{ id: 'A', type: 'page', url: 'https://www.tradingview.com/chart/abc', title: 'A' }])
      : new Response('No such target id', { status: 404 }));
    await assert.rejects(switchTab({ index: 0 }), /Failed to activate tab 0: .*HTTP 404/);
  });
});

describe('connection — concurrency & error handling', () => {
  it('safeString throws on null/undefined to surface caller bugs', () => {
    assert.throws(() => connection.safeString(null), /must not be null or undefined/);
    assert.throws(() => connection.safeString(undefined), /must not be null or undefined/);
  });

  it('requireFinite rejects NaN, Infinity, and non-numeric strings', () => {
    assert.throws(() => connection.requireFinite(NaN, 'x'), /finite number/);
    assert.throws(() => connection.requireFinite(Infinity, 'x'), /finite number/);
    assert.throws(() => connection.requireFinite('not-a-num', 'x'), /finite number/);
    assert.equal(connection.requireFinite(42, 'x'), 42);
    assert.equal(connection.requireFinite('42', 'x'), 42);
  });
});

describe('debug helper', () => {
  it('respects DEBUG env var matcher', () => {
    const original = process.env.DEBUG;
    try {
      delete process.env.DEBUG;
      assert.equal(isDebugEnabled(), false);
    } finally {
      if (original !== undefined) process.env.DEBUG = original;
      else delete process.env.DEBUG;
    }
  });

  it('writes to stderr when enabled', () => {
    const original = process.env.DEBUG;
    process.env.DEBUG = 'tv-mcp,other';
    try {
      assert.equal(isDebugEnabled(), true);

      const writes: string[] = [];
      const origWrite = process.stderr.write;
      process.stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
      try {
        debug('test', 'hello', 'world');
      } finally {
        process.stderr.write = origWrite;
      }
      assert.match(writes.join(''), /\[tv-mcp:test\] hello world/);
    } finally {
      if (original !== undefined) process.env.DEBUG = original;
      else delete process.env.DEBUG;
    }
  });
});
