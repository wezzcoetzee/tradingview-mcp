import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { findNewAlert } from '../src/core/alerts.js';

describe('findNewAlert', () => {
  it('returns the alert whose id was not present before', () => {
    const found = findNewAlert([{ alert_id: 1 }], [{ alert_id: 1 }, { alert_id: 2 }]);
    assert.equal(found?.alert_id, 2);
  });

  it('returns undefined when nothing new appeared', () => {
    assert.equal(findNewAlert([{ alert_id: 1 }], [{ alert_id: 1 }]), undefined);
  });
});
