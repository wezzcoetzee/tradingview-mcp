import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { findNewAlert, deleteAlerts } from '../src/core/alerts.js';

describe('findNewAlert', () => {
  it('returns the alert whose id was not present before', () => {
    const found = findNewAlert([{ alert_id: 1 }], [{ alert_id: 1 }, { alert_id: 2 }]);
    assert.equal(found?.alert_id, 2);
  });

  it('returns undefined when nothing new appeared', () => {
    assert.equal(findNewAlert([{ alert_id: 1 }], [{ alert_id: 1 }]), undefined);
  });
});

describe('deleteAlerts', () => {
  const makeIO = (initial: { alert_id: number }[], removes = true) => {
    let alerts = initial;
    const posted: (string | number)[][] = [];
    return {
      posted,
      io: {
        list: async () => ({ alerts }),
        post: async (ids: (string | number)[]) => {
          posted.push(ids);
          if (removes) alerts = alerts.filter(a => !ids.includes(a.alert_id));
          return { ok: true };
        },
      },
    };
  };

  it('requires an explicit target', async () => {
    const { io, posted } = makeIO([{ alert_id: 1 }]);
    assert.equal((await deleteAlerts({}, io)).success, false);
    assert.equal((await deleteAlerts({ alert_id: 1, delete_all: true }, io)).success, false);
    assert.equal(posted.length, 0);
  });

  it('deletes the requested ids and verifies by re-listing', async () => {
    const { io, posted } = makeIO([{ alert_id: 1 }, { alert_id: 2 }]);
    const result = await deleteAlerts({ alert_id: ['1'] }, io);
    assert.equal(result.success, true);
    assert.deepEqual(posted, [[1]]);
  });

  it('deletes everything with delete_all', async () => {
    const { io, posted } = makeIO([{ alert_id: 1 }, { alert_id: 2 }]);
    assert.equal((await deleteAlerts({ delete_all: true }, io)).success, true);
    assert.deepEqual(posted, [[1, 2]]);
  });

  it('fails without posting when an id is unknown', async () => {
    const { io, posted } = makeIO([{ alert_id: 1 }]);
    const result = await deleteAlerts({ alert_id: 9 }, io);
    assert.equal(result.success, false);
    assert.equal(posted.length, 0);
  });

  it('fails when alerts survive the delete', async () => {
    const { io } = makeIO([{ alert_id: 1 }], false);
    const result = await deleteAlerts({ alert_id: 1 }, io);
    assert.equal(result.success, false);
    assert.deepEqual((result as { remaining?: unknown }).remaining, [1]);
  });
});
