import { describe, it, expect } from 'bun:test';
import { shortcutModifier, parseScriptTitle, matchesSavedScript } from '../src/core/pine.js';

describe('shortcutModifier', () => {
  it('uses Cmd on macOS and Ctrl elsewhere', () => {
    expect(shortcutModifier('darwin')).toBe(4);
    expect(shortcutModifier('linux')).toBe(2);
    expect(shortcutModifier('win32')).toBe(2);
  });
});

describe('parseScriptTitle', () => {
  it('reads the declaration title', () => {
    expect(parseScriptTitle('//@version=6\nstrategy("My Strat", overlay=true)')).toBe('My Strat');
    expect(parseScriptTitle("indicator(title='RSI x')")).toBe('RSI x');
    expect(parseScriptTitle('library("Lib")')).toBe('Lib');
  });
  it('returns null without a declaration', () => {
    expect(parseScriptTitle('plot(close)')).toBeNull();
  });
});

describe('matchesSavedScript', () => {
  const saved = [{ name: 'My Strat', title: null }, { name: 'file', title: 'Other' }];
  it('matches name or title case-insensitively', () => {
    expect(matchesSavedScript('my strat', saved)).toBe(true);
    expect(matchesSavedScript('OTHER', saved)).toBe(true);
  });
  it('does not match unknown or missing titles', () => {
    expect(matchesSavedScript('Nope', saved)).toBe(false);
    expect(matchesSavedScript(null, saved)).toBe(false);
  });
});
