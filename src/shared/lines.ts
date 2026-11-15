// Pure line-based text helpers shared by the host and the webview.
// All functions expect "\n" line endings.

import type { LineEdit } from './protocol';

export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function getLines(source: string, start: number, end: number): string {
  return source.split('\n').slice(start, end).join('\n');
}

/** Number of lines `text` occupies when inserted as a block ("" occupies none). */
export function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length;
}

/** Replace lines [start, end) of `source` with `newText` ("" removes the lines). */
export function replaceLines(source: string, start: number, end: number, newText: string): string {
  const lines = source.split('\n');
  const middle = newText === '' ? [] : newText.split('\n');
  return [...lines.slice(0, start), ...middle, ...lines.slice(end)].join('\n');
}

/**
 * After a block was emptied at `line`, return an edit that removes the now
 * doubled blank line so deleted paragraphs don't leave growing gaps behind.
 */
export function collapseBlankLine(source: string, line: number): LineEdit | undefined {
  const lines = source.split('\n');
  const isBlank = (i: number) => i >= 0 && i < lines.length && lines[i].trim() === '';
  if (isBlank(line) && (isBlank(line - 1) || line === 0) && line < lines.length - 1) {
    return { start: line, end: line + 1, oldText: lines[line], newText: '' };
  }
  return undefined;
}

/** Apply a LineEdit, or return undefined when the source no longer matches `oldText`. */
export function applyLineEdit(source: string, edit: LineEdit): string | undefined {
  if (getLines(source, edit.start, edit.end) !== edit.oldText) {
    return undefined;
  }
  return replaceLines(source, edit.start, edit.end, edit.newText);
}

/**
 * Make sure the document ends with a blank line so a new block can be appended,
 * and return the line index where that new block starts.
 */
export function prepareAppend(source: string): { source: string; line: number } {
  let next = source.replace(/\s+$/, '');
  next = next === '' ? '' : `${next}\n\n`;
  return { source: next, line: next === '' ? 0 : next.split('\n').length - 1 };
}

/** Smallest single replacement turning `a` into `b`, as [start, endInA, insertText]. */
export function minimalDiff(a: string, b: string): { start: number; end: number; text: string } | undefined {
  if (a === b) {
    return undefined;
  }
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  // Never split a surrogate pair (emoji etc.).
  if (start > 0 && isHighSurrogate(a.charCodeAt(start - 1))) {
    start--;
  }
  if (endA < a.length && isLowSurrogate(a.charCodeAt(endA))) {
    endA++;
    endB++;
  }
  return { start, end: endA, text: b.slice(start, endB) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
