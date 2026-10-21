import { it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';

it('auto-launches once, respects opt-out, and resets for the next session without starting the app', () => {
  // Isolate module mocks so other tests keep the real health implementation.
  const result = spawnSync(process.execPath, ['-e', `
    import { mock } from 'bun:test';
    import assert from 'node:assert/strict';
    let launches = 0;
    mock.module('./src/core/health.js', () => ({ launch: async () => { launches++; } }));
    globalThis.fetch = async () => { throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }); };
    const { connect, resetAutoLaunchLatch } = await import('./src/connection.ts');
    process.env.TV_MCP_AUTO_LAUNCH = '0';
    await assert.rejects(connect(), /Cannot reach TradingView/);
    assert.equal(launches, 0);
    delete process.env.TV_MCP_AUTO_LAUNCH;
    await assert.rejects(connect(), /Cannot reach TradingView/);
    await assert.rejects(connect(), /Cannot reach TradingView/);
    assert.equal(launches, 1);
    resetAutoLaunchLatch();
    await assert.rejects(connect(), /Cannot reach TradingView/);
    assert.equal(launches, 2);
  `], { cwd: process.cwd(), encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

it('leaves a manually opened session alone when only_if_agent_launched is set', () => {
  const result = spawnSync(process.execPath, ['-e', `
    import assert from 'node:assert/strict';
    globalThis.fetch = async () => Response.json({ Browser: 'test' });
    const { quitTradingView } = await import('./src/core/ensure_tv.ts');
    const result = await quitTradingView({ only_if_agent_launched: true });
    assert.equal(result.success, true);
    assert.equal(result.skipped, true);
    assert.equal(result.cdp_down, false);
  `], { cwd: process.cwd(), encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
