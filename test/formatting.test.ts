import { describe, expect, it } from 'vitest';
import {
  continueList,
  indentLines,
  insertLink,
  toggleCodeBlock,
  toggleInline,
  toggleLinePrefix,
  toggleTaskLine,
  type TextChange,
  type TextState,
} from '../src/webview/ui/formatting';

const apply = (state: TextState, change: TextChange) => ({
  value: state.value.slice(0, change.from) + change.insert + state.value.slice(change.to),
  selected: (state.value.slice(0, change.from) + change.insert + state.value.slice(change.to)).slice(change.selStart, change.selEnd),
});

describe('inline formatting', () => {
  it('wraps the selection in bold and unwraps it again', () => {
    const state = { value: 'say hello world', start: 4, end: 9 };
    const once = apply(state, toggleInline(state, 'bold'));
    expect(once.value).toBe('say **hello** world');
    expect(once.selected).toBe('hello');
    const again = { value: once.value, start: 6, end: 11 };
    expect(apply(again, toggleInline(again, 'bold')).value).toBe('say hello world');
  });

  it('wraps the word under a collapsed caret', () => {
    const state = { value: 'say hello world', start: 6, end: 6 };
    expect(apply(state, toggleInline(state, 'italic')).value).toBe('say _hello_ world');
  });

  it('creates links and selects the URL placeholder', () => {
    const state = { value: 'see docs', start: 4, end: 8 };
    const result = apply(state, insertLink(state));
    expect(result.value).toBe('see [docs](https://)');
    expect(result.selected).toBe('https://');
  });
});

describe('line formatting', () => {
  it('cycles headings', () => {
    let state = { value: 'Title', start: 0, end: 0 };
    const levels: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = apply(state, toggleLinePrefix(state, 'heading')).value;
      levels.push(next);
      state = { value: next, start: 0, end: 0 };
    }
    expect(levels).toEqual(['# Title', '## Title', '### Title', 'Title']);
  });

  it('toggles bullets, numbers, tasks and quotes over several lines', () => {
    const state = { value: 'one\ntwo', start: 0, end: 7 };
    expect(apply(state, toggleLinePrefix(state, 'bullet')).value).toBe('- one\n- two');
    expect(apply(state, toggleLinePrefix(state, 'ordered')).value).toBe('1. one\n2. two');
    expect(apply(state, toggleLinePrefix(state, 'task')).value).toBe('- [ ] one\n- [ ] two');
    expect(apply(state, toggleLinePrefix(state, 'quote')).value).toBe('> one\n> two');
    const bulleted = { value: '- one\n- two', start: 0, end: 11 };
    expect(apply(bulleted, toggleLinePrefix(bulleted, 'bullet')).value).toBe('one\ntwo');
  });

  it('wraps and unwraps code blocks', () => {
    const state = { value: 'let a = 1;', start: 0, end: 0 };
    const fenced = apply(state, toggleCodeBlock(state)).value;
    expect(fenced).toBe('```\nlet a = 1;\n```');
    const back = { value: fenced, start: 0, end: fenced.length };
    expect(apply(back, toggleCodeBlock(back)).value).toBe('let a = 1;');
  });

  it('indents and outdents', () => {
    const state = { value: '- a\n- b', start: 5, end: 5 };
    const indented = apply(state, indentLines(state, false)).value;
    expect(indented).toBe('- a\n  - b');
    const back = { value: indented, start: 8, end: 8 };
    expect(apply(back, indentLines(back, true)).value).toBe('- a\n- b');
  });
});

describe('list continuation', () => {
  it('continues bullets, numbers and tasks', () => {
    const at = (value: string) => ({ value, start: value.length, end: value.length });
    expect(apply(at('- item'), continueList(at('- item'))!).value).toBe('- item\n- ');
    expect(apply(at('9. item'), continueList(at('9. item'))!).value).toBe('9. item\n10. ');
    expect(apply(at('- [x] done'), continueList(at('- [x] done'))!).value).toBe('- [x] done\n- [ ] ');
    expect(apply(at('> - quoted'), continueList(at('> - quoted'))!).value).toBe('> - quoted\n> - ');
  });

  it('ends the list on an empty item', () => {
    const state = { value: '- a\n- ', start: 6, end: 6 };
    expect(apply(state, continueList(state)!).value).toBe('- a\n');
  });

  it('ignores non-list lines', () => {
    expect(continueList({ value: 'plain', start: 5, end: 5 })).toBeUndefined();
  });
});

describe('toggleTaskLine', () => {
  it('flips checkboxes', () => {
    expect(toggleTaskLine('- [ ] todo')).toBe('- [x] todo');
    expect(toggleTaskLine('  * [X] done')).toBe('  * [ ] done');
    expect(toggleTaskLine('1. [ ] numbered')).toBe('1. [x] numbered');
    expect(toggleTaskLine('- no box')).toBeUndefined();
  });
});
