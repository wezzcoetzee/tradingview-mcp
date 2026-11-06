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

// Run the shipped dialog code in an isolated DOM-shaped fixture, without CDP or app sessions.
import { runInNewContext } from 'node:vm';
import { create, configureDialog, verifyCreatedAlert, type AlertRequest, type CreateIO } from '../src/core/alerts.js';
const requested: AlertRequest = { price: 123, message: 'level', condition: 'crossing_up', frequency: 'once_per_bar_close',
  resolution: '5', expiry: 2_000_000_000, expected_symbol: 'EX:A' };

function dialogFixture(missing?: string) {
  let writes = 0;
  let submits = 0;
  class Input {
    stored = ''; disabled = false; labels = []; type = 'number';
    constructor(public label: string) {}
    get value() { return this.stored; }
    set value(value: string) { writes++; this.stored = value; }
    getAttribute(name: string) { return name === 'aria-label' ? this.label : null; }
    dispatchEvent() {}
    checkValidity() { return true; }
  }
  class Select extends Input {
    options: { textContent: string; value: string; disabled: boolean }[];
    constructor(label: string, values: string[]) { super(label); this.options = values.map(value => ({ textContent: value, value, disabled: false })); }
    get value() { return super.value; }
    set value(value: string) { super.value = value; }
  }
  class Textarea extends Input {
    get value() { return super.value; }
    set value(value: string) { super.value = value; }
  }
  const expiry = new Input('Expiration time'); expiry.type = 'datetime-local';
  const fields = [new Select('Symbol', ['EX:A']), new Select('Source', ['Price']), new Select('Condition', ['Crossing Up']), new Select('Trigger', ['Once Per Bar Close']),
    new Select('Interval', ['5']), new Input('Value'), expiry, new Textarea('Message')].filter(field => field.label !== missing);
  const button = { textContent: 'Create', disabled: false, click() { submits++; } };
  const dialog = { querySelectorAll: (selector: string) => selector === 'button' ? [button] : fields };
  const context = { document: { querySelectorAll: () => [dialog] },
    window: { TradingViewApi: { _activeChartWidgetWV: { value: () => ({ symbol: () => 'EX:A', resolution: () => '5' }) } } },
    HTMLInputElement: Input, HTMLSelectElement: Select, HTMLTextAreaElement: Textarea, Event };
  const run = (submit = false) => runInNewContext(`(${configureDialog.toString()})(${JSON.stringify(requested)}, ${submit})`, context) as { ok: boolean; error?: string };
  return { run, fields, writes: () => writes, submits: () => submits };
}

describe('exact alert configuration', () => {
  it('validates inputs before evaluating or opening any app controls', async () => {
    const evaluate: CreateIO['evaluate'] = async () => { throw Error('must not evaluate'); };
    for (const options of [{ price: NaN }, { price: 1, expiry: 0 }, { price: Infinity }, { price: 1, resolution: 'invalid' }]) {
      assert.equal((await create(options, { evaluate })).status, 'refused');
    }
  });
  it('preflights every control before field writes and never submits a default', () => {
    const fixture = dialogFixture('Trigger');
    assert.equal(fixture.run().ok, false);
    assert.equal(fixture.writes(), 0);
    assert.equal(fixture.submits(), 0);
  });
  it('sets exact condition/frequency/price/resolution/message/expiry and rechecks before submit', () => {
    const fixture = dialogFixture();
    assert.equal(fixture.run().ok, true);
    assert.equal(fixture.fields.find(field => field.label === 'Trigger')?.value, 'Once Per Bar Close');
    assert.equal(fixture.fields.find(field => field.label === 'Condition')?.value, 'Crossing Up');
    assert.equal(fixture.fields.find(field => field.label === 'Value')?.value, '123');
    assert.equal(fixture.submits(), 0);
    assert.equal(fixture.run(true).ok, true);
    assert.equal(fixture.submits(), 1);
    fixture.fields.find(field => field.label === 'Value')!.value = '999';
    assert.equal(fixture.run(true).ok, false);
    assert.equal(fixture.submits(), 1);
  });
  it('reports list field mismatches and never decodes opaque condition data by guessing', () => {
    const verification = verifyCreatedAlert(requested, { alert_id: 1, symbol: 'EX:B', resolution: '5', condition: { arbitrary: true }, expiration: requested.expiry });
    assert.deepEqual(verification.mismatched, ['symbol']);
    assert.ok(verification.unverified.includes('frequency'));
    assert.ok(verification.unverified.includes('condition'));
    assert.ok(verification.unverified.includes('price'));
  });
  it('does not claim success from a new id and returns defaults explicitly', async () => {
    let lists = 0;
    const result = await create({ price: 1 }, {
      evaluate: async expression => expression.startsWith('({ symbol:') ? { symbol: 'EX:A', resolution: '5' }
        : expression.includes('configureDialog') ? { ok: true } : true,
      list: async () => ({ alerts: lists++ ? [{ alert_id: 1 }] : [] }), sleep: async () => {}, now: () => 1000,
    });
    assert.equal(result.success, false);
    assert.equal(result.status, 'unverified');
    assert.equal(result.alert_id, 1);
    assert.equal(result.requested?.condition, 'crossing');
    assert.equal(result.requested?.frequency, 'once');
    assert.equal(result.requested?.expiry, 1 + 30 * 86400);
  });
  it('refuses expected symbol mismatch before opening or listing', async () => {
    let calls = 0;
    const result = await create({ price: 1, expected_symbol: 'EX:B' }, {
      evaluate: async () => { calls++; return { symbol: 'EX:A', resolution: '5' }; },
      list: async () => { throw Error('must not list'); },
    });
    assert.equal(result.status, 'refused'); assert.equal(calls, 1);
  });
});

it('preserves an explicit unknown outcome if submission/verification throws', async () => {
  const result = await create({ price: 1 }, {
    evaluate: async expression => {
      if (expression.startsWith('({ symbol:')) return { symbol: 'EX:A', resolution: '5' };
      if (expression.includes('configureDialog')) {
        if (expression.endsWith(', true)')) throw Error('connection dropped');
        return { ok: true };
      }
      return true;
    },
    list: async () => ({ alerts: [] }), sleep: async () => {},
  });
  assert.equal(result.status, 'unverified');
  assert.equal(result.submission_attempted, true);
});
