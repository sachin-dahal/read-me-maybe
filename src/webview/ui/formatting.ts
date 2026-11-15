// Pure text transforms for the inline block editor. Each returns the slice of
// the value to replace plus the selection to restore, so the caller can apply
// it with execCommand('insertText') and keep native undo working.

export interface TextState {
  value: string;
  start: number;
  end: number;
}

export interface TextChange {
  /** Range of the original value to replace. */
  from: number;
  to: number;
  insert: string;
  /** Selection after the change, in the new value. */
  selStart: number;
  selEnd: number;
}

export type InlineFormat = 'bold' | 'italic' | 'strike' | 'code';
export type LineFormat = 'heading' | 'bullet' | 'ordered' | 'task' | 'quote';

const MARKERS: Record<InlineFormat, string> = { bold: '**', italic: '_', strike: '~~', code: '`' };

function wordAt(value: string, pos: number): [number, number] {
  let a = pos;
  let b = pos;
  while (a > 0 && /[\p{L}\p{N}_]/u.test(value[a - 1])) {
    a--;
  }
  while (b < value.length && /[\p{L}\p{N}_]/u.test(value[b])) {
    b++;
  }
  return [a, b];
}

export function toggleInline({ value, start, end }: TextState, format: InlineFormat): TextChange {
  const marker = MARKERS[format];
  const m = marker.length;
  if (start === end) {
    const [a, b] = wordAt(value, start);
    if (a !== b) {
      start = a;
      end = b;
    }
  }
  // Already wrapped from the outside: **|text|**
  if (value.slice(start - m, start) === marker && value.slice(end, end + m) === marker) {
    const inner = value.slice(start, end);
    return { from: start - m, to: end + m, insert: inner, selStart: start - m, selEnd: end - m };
  }
  const selected = value.slice(start, end);
  // Wrapped from the inside: |**text**|
  if (selected.length >= m * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    return { from: start, to: end, insert: inner, selStart: start, selEnd: start + inner.length };
  }
  return {
    from: start,
    to: end,
    insert: `${marker}${selected}${marker}`,
    selStart: start + m,
    selEnd: end + m,
  };
}

export function insertLink({ value, start, end }: TextState): TextChange {
  const selected = value.slice(start, end);
  if (/^https?:\/\/\S+$/.test(selected)) {
    const insert = `[link](${selected})`;
    return { from: start, to: end, insert, selStart: start + 1, selEnd: start + 5 };
  }
  const label = selected || 'link text';
  const insert = `[${label}](https://)`;
  const urlStart = start + label.length + 3;
  return selected
    ? { from: start, to: end, insert, selStart: urlStart, selEnd: urlStart + 8 }
    : { from: start, to: end, insert, selStart: start + 1, selEnd: start + 1 + label.length };
}

function lineBounds(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  if (to === -1) {
    to = value.length;
  }
  return [from, to];
}

const LIST_PREFIX = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
const HEADING_PREFIX = /^(#{1,6})\s+/;
const QUOTE_PREFIX = /^>\s?/;

export function toggleLinePrefix({ value, start, end }: TextState, format: LineFormat): TextChange {
  const [from, to] = lineBounds(value, start, end);
  const lines = value.slice(from, to).split('\n');
  let next: string[];

  switch (format) {
    case 'heading': {
      // Cycle: paragraph -> # -> ## -> ### -> paragraph
      const level = HEADING_PREFIX.exec(lines[0])?.[1].length ?? 0;
      const nextLevel = level >= 3 ? 0 : level + 1;
      next = lines.map((line) => {
        const body = line.replace(HEADING_PREFIX, '');
        return nextLevel ? `${'#'.repeat(nextLevel)} ${body}` : body;
      });
      break;
    }
    case 'quote': {
      const all = lines.every((line) => QUOTE_PREFIX.test(line));
      next = lines.map((line) => (all ? line.replace(QUOTE_PREFIX, '') : `> ${line}`));
      break;
    }
    default: {
      const pattern =
        format === 'bullet' ? /^\s*[-*+]\s+(?!\[[ xX]\])/ : format === 'task' ? /^\s*[-*+]\s+\[[ xX]\]\s+/ : /^\s*\d+[.)]\s+/;
      const all = lines.filter((l) => l.trim() !== '').every((line) => pattern.test(line));
      let n = 0;
      next = lines.map((line) => {
        if (line.trim() === '' && lines.length > 1) {
          return line;
        }
        const indent = /^\s*/.exec(line)?.[0] ?? '';
        const body = line.replace(LIST_PREFIX, '').trimStart();
        if (all) {
          return indent + body;
        }
        n++;
        const marker = format === 'bullet' ? '- ' : format === 'task' ? '- [ ] ' : `${n}. `;
        return indent + marker + body;
      });
    }
  }

  const insert = next.join('\n');
  const delta = insert.length - (to - from);
  // Keep the caret at the end of the edited text for a collapsed single-line selection.
  if (start === end && lines.length === 1) {
    const caret = Math.max(from, Math.min(from + insert.length, end + delta));
    return { from, to, insert, selStart: caret, selEnd: caret };
  }
  return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

export function toggleCodeBlock({ value, start, end }: TextState): TextChange {
  const [from, to] = lineBounds(value, start, end);
  const body = value.slice(from, to);
  const fenced = /^(```|~~~)[^\n]*\n([\s\S]*)\n\1\s*$/.exec(body);
  if (fenced) {
    return { from, to, insert: fenced[2], selStart: from, selEnd: from + fenced[2].length };
  }
  const insert = `\`\`\`\n${body}\n\`\`\``;
  return { from, to, insert, selStart: from + 4, selEnd: from + 4 + body.length };
}

export function indentLines({ value, start, end }: TextState, outdent: boolean): TextChange {
  const [from, to] = lineBounds(value, start, end);
  const lines = value.slice(from, to).split('\n');
  let firstDelta = 0;
  const next = lines.map((line, i) => {
    if (outdent) {
      const removed = /^( {1,2}|\t)/.exec(line)?.[0].length ?? 0;
      if (i === 0) {
        firstDelta = -removed;
      }
      return line.slice(removed);
    }
    if (i === 0) {
      firstDelta = 2;
    }
    return `  ${line}`;
  });
  const insert = next.join('\n');
  if (start === end) {
    const caret = Math.max(from, start + firstDelta);
    return { from, to, insert, selStart: caret, selEnd: caret };
  }
  return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

const CONTINUE = /^(\s*)(?:(>\s?)+)?([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

/** Enter inside a list item continues the list; Enter on an empty item ends it. */
export function continueList({ value, start, end }: TextState): TextChange | undefined {
  if (start !== end) {
    return undefined;
  }
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', start) === -1 ? value.length : value.indexOf('\n', start);
  const line = value.slice(lineStart, lineEnd);
  const match = CONTINUE.exec(line);
  if (!match || start < lineStart + match[0].length) {
    return undefined;
  }
  if (line.slice(match[0].length).trim() === '') {
    // Empty item: drop the marker and leave the list.
    return { from: lineStart, to: lineEnd, insert: '', selStart: lineStart, selEnd: lineStart };
  }
  const [, indent, quote = '', bullet, space, task] = match;
  const nextBullet = /^\d+/.test(bullet) ? `${Number.parseInt(bullet, 10) + 1}${bullet.slice(-1)}` : bullet;
  const insert = `\n${indent}${quote}${nextBullet}${space}${task ? '[ ] ' : ''}`;
  return { from: start, to: end, insert, selStart: start + insert.length, selEnd: start + insert.length };
}

/** Flip the first task checkbox on a source line. */
export function toggleTaskLine(line: string): string | undefined {
  const match = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line);
  if (!match) {
    return undefined;
  }
  const mark = match[2] === ' ' ? 'x' : ' ';
  return `${match[1]}[${mark}]${line.slice(match[0].length)}`;
}
