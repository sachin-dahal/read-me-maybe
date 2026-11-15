import { describe, expect, it } from 'vitest';
import { applyLineEdit, collapseBlankLine, minimalDiff, normalizeEol, prepareAppend, replaceLines } from '../src/shared/lines';

describe('replaceLines', () => {
  it('replaces a block in the middle', () => {
    expect(replaceLines('a\n\nb\n\nc\n', 2, 3, 'B')).toBe('a\n\nB\n\nc\n');
  });

  it('can grow a block', () => {
    expect(replaceLines('a\nb\n', 0, 1, 'x\ny')).toBe('x\ny\nb\n');
  });

  it('handles files without a trailing newline', () => {
    expect(replaceLines('a\n\nb', 2, 3, 'c')).toBe('a\n\nc');
  });

  it('keeps separators while a block is emptied, then collapses them', () => {
    const emptied = replaceLines('a\n\nb\n\nc\n', 2, 3, '');
    expect(emptied).toBe('a\n\n\nc\n');
    // Typing again lands in its own paragraph instead of merging into "c".
    expect(replaceLines(emptied, 2, 2, 'x')).toBe('a\n\nx\n\nc\n');
    const cleanup = collapseBlankLine(emptied, 2)!;
    expect(applyLineEdit(emptied, cleanup)).toBe('a\n\nc\n');
    expect(collapseBlankLine('a\n\nb', 1)).toBeUndefined();
  });
});

describe('applyLineEdit', () => {
  it('rejects edits against stale text', () => {
    expect(applyLineEdit('a\nb\n', { start: 0, end: 1, oldText: 'zzz', newText: 'q' })).toBeUndefined();
    expect(applyLineEdit('a\nb\n', { start: 1, end: 2, oldText: 'b', newText: 'q' })).toBe('a\nq\n');
  });

  it('supports insertion at an empty range', () => {
    const { source, line } = prepareAppend('# Hi');
    expect(source).toBe('# Hi\n\n');
    expect(applyLineEdit(source, { start: line, end: line, oldText: '', newText: 'New' })).toBe('# Hi\n\nNew\n');
  });

  it('prepares appends on empty documents', () => {
    expect(prepareAppend('  \n')).toEqual({ source: '', line: 0 });
    expect(applyLineEdit('', { start: 0, end: 0, oldText: '', newText: 'Hello' })).toBe('Hello\n');
  });
});

describe('minimalDiff', () => {
  it('finds the smallest replacement', () => {
    expect(minimalDiff('hello world', 'hello brave world')).toEqual({ start: 6, end: 6, text: 'brave ' });
    expect(minimalDiff('same', 'same')).toBeUndefined();
  });

  it('never splits surrogate pairs', () => {
    const diff = minimalDiff('a😀b', 'a😁b')!;
    expect(diff.start).toBe(1);
    expect(diff.text).toBe('😁');
  });

  it('normalizes CRLF', () => {
    expect(normalizeEol('a\r\nb\rc')).toBe('a\nb\nc');
  });
});
