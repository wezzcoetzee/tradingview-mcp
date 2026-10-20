import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { resolveKey, keyEvents, clickEvents } from '../src/core/ui.js';

describe('resolveKey', () => {
  it('maps digits to Digit codes', () => {
    assert.deepEqual(resolveKey('1'), { key: '1', code: 'Digit1', vk: 49, text: '1' });
  });

  it('maps letters and function keys', () => {
    assert.equal(resolveKey('s').code, 'KeyS');
    assert.equal(resolveKey('F5').vk, 116);
    assert.equal(resolveKey('F12').vk, 123);
  });

  it('rejects unknown keys', () => {
    assert.throws(() => resolveKey('Banana'));
  });
});

describe('keyEvents', () => {
  it('sends text on keyDown for printable keys', () => {
    const [down, up] = keyEvents('a');
    assert.equal(down.text, 'a');
    assert.equal(up.text, undefined);
  });

  it('keeps modifiers on keyUp and drops text for shortcuts', () => {
    const [down, up] = keyEvents('s', ['ctrl', 'shift']);
    assert.equal(down.modifiers, 10);
    assert.equal(up.modifiers, 10);
    assert.equal(down.text, undefined);
  });

  it('sends a carriage return for Enter', () => {
    assert.equal(keyEvents('Enter')[0].text, '\r');
  });
});

describe('clickEvents', () => {
  it('sets clickCount on press and release', () => {
    const [press, release] = clickEvents(10, 20, 'left', 2);
    assert.equal(press.clickCount, 2);
    assert.equal(release.clickCount, 2);
    assert.equal(release.buttons, 0);
  });
});
