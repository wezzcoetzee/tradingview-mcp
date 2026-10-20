import { describe, expect, it } from 'bun:test';
import { zBool } from '../src/tools/_format.js';

describe('zBool', () => {
  it('parses booleans and "true"/"false" strings without Boolean() coercion', () => {
    expect(zBool.parse('false')).toBe(false);
    expect(zBool.parse('true')).toBe(true);
    expect(zBool.parse(false)).toBe(false);
    expect(zBool.parse(true)).toBe(true);
  });

  it('rejects other strings', () => {
    expect(zBool.safeParse('yes').success).toBe(false);
  });
});
