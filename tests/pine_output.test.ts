import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { sliceSource, trimConsole } from '../src/core/pine.js';

const script = ['//@version=6', 'indicator("x")', 'plot(close)', 'plot(open)'].join('\n');

describe('sliceSource', () => {
  it('returns everything by default with total_lines', () => {
    const r = sliceSource(script);
    assert.equal(r.source, script);
    assert.equal(r.total_lines, 4);
    assert.equal(r.truncated, false);
  });

  it('reads a 1-based inclusive line range', () => {
    const r = sliceSource(script, { from_line: 2, to_line: 3 });
    assert.equal(r.source, 'indicator("x")\nplot(close)');
    assert.deepEqual([r.from_line, r.to_line], [2, 3]);
  });

  it('clamps to_line to the script and rejects an inverted range', () => {
    assert.equal(sliceSource(script, { from_line: 4, to_line: 99 }).source, 'plot(open)');
    assert.throws(() => sliceSource(script, { from_line: 5 }), /must not be after/);
    assert.throws(() => sliceSource(script, { from_line: 3, to_line: 2 }), /must not be after/);
  });

  it('cuts to max_chars and flags truncation', () => {
    const r = sliceSource(script, { max_chars: 20 });
    assert.equal(r.source.length, 20);
    assert.equal(r.truncated, true);
    assert.equal(r.total_lines, 4);
    assert.equal(sliceSource(script, { max_chars: 1000 }).truncated, false);
  });

  it('to_line is the last whole line when the cut lands mid-line', () => {
    // line 1 is 12 chars; 20 chars reaches into line 2
    assert.equal(sliceSource(script, { max_chars: 20 }).to_line, 1);
    // exactly lines 1-2 (12 + 1 + 14 = 27 chars)
    const whole = sliceSource(script, { max_chars: 27 });
    assert.equal(whole.to_line, 2);
    assert.equal(whole.truncated, true);
  });
});

describe('trimConsole', () => {
  const entry = (message: string, timestamp: string | null = '10:00:00') => ({ timestamp, type: 'info', message });

  it('keeps repeated log lines and returns the newest limit', () => {
    const entries = [entry('a'), entry('a'), entry('b'), entry('c'), entry('a')];
    const r = trimConsole(entries, 3);
    assert.equal(r.total, 5);
    assert.deepEqual(r.entries.map(e => e.message), ['b', 'c', 'a']);
    assert.equal(trimConsole(entries.slice(0, 2)).entries.length, 2);
  });

  it('defaults to 50 and limit 0 returns none', () => {
    const many = Array.from({ length: 80 }, (_, i) => entry(`m${i}`));
    assert.equal(trimConsole(many).entries.length, 50);
    assert.equal(trimConsole(many).total, 80);
    assert.deepEqual(trimConsole(many, 0).entries, []);
  });
});
