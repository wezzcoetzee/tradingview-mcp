import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { symbolMatches, get } from '../src/core/watchlist.js';

describe('symbolMatches', () => {
  it('matches exact and case-insensitive symbols', () => {
    assert.ok(symbolMatches('nasdaq:aapl', 'NASDAQ:AAPL'));
  });

  it('matches an exchange-qualified request against a ticker-only listing', () => {
    assert.ok(symbolMatches('NYMEX:CL1!', 'CL1!'));
    assert.ok(symbolMatches('AAPL', 'NASDAQ:AAPL'));
  });

  it('rejects the same ticker on a different exchange', () => {
    assert.ok(!symbolMatches('NYSE:ABC', 'NASDAQ:ABC'));
  });

  it('rejects different tickers', () => {
    assert.ok(!symbolMatches('AAPL', 'AAPL2'));
  });
});

describe('get', () => {
  it('fails instead of reporting an empty watchlist when the panel is closed', async () => {
    const result = await get({ _deps: { evaluate: async () => ({ symbols: [], source: 'panel_closed' }) } });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /panel is closed/);
    assert.deepEqual(result.symbols, []);
  });
});
