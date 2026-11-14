// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { LONG_PRESS, ownsContextMenu } from './context-menu';

/** An element inside a `<td>`, as a contextmenu event names it, made from the markup of the cell's content. */
const targetIn = (markup: string, selector: string): Element => {
  const cell = document.createElement('td');
  cell.innerHTML = markup;
  const element = cell.querySelector(selector);
  if (element === null) throw new Error(`No ${selector} in ${markup}`);
  return element;
};

const PLAIN = { shiftKey: false, target: document.createElement('td'), fromKeyboard: false } as const;

describe('LONG_PRESS', () => {
  it('is half a second with a slop of ten pixels', () => {
    expect(LONG_PRESS).toEqual({ delayMs: 500, slopPx: 10 });
  });
});

describe('ownsContextMenu', () => {
  it("is the table's for a plain right click on a cell", () => {
    expect(ownsContextMenu(PLAIN, true)).toBe(true);
    expect(ownsContextMenu({ ...PLAIN, target: targetIn('<span>text</span>', 'span') }, true)).toBe(true);
    // A button is not the browser's own menu: the More button and a copy button are part of the row
    expect(ownsContextMenu({ ...PLAIN, target: targetIn('<button>Copy</button>', 'button') }, true)).toBe(true);
  });

  it('leaves Shift plus right click to the browser', () => {
    expect(ownsContextMenu({ ...PLAIN, shiftKey: true }, true)).toBe(false);
  });

  it('leaves a link, an input, a textarea, a select and a contenteditable to the browser', () => {
    const cases: [string, string][] = [
      ['<a href="/page"><span>link</span></a>', 'span'],
      ['<a href="/page">link</a>', 'a'],
      ['<input type="text" />', 'input'],
      ['<textarea></textarea>', 'textarea'],
      ['<select><option>a</option></select>', 'select'],
      ['<div contenteditable="true"><b>text</b></div>', 'b'],
      ['<div contenteditable><b>text</b></div>', 'b'],
    ];
    for (const [markup, selector] of cases) {
      expect(ownsContextMenu({ ...PLAIN, target: targetIn(markup, selector) }, true)).toBe(false);
    }
  });

  it('does not take an anchor without an href or contenteditable turned off for a browser control', () => {
    expect(ownsContextMenu({ ...PLAIN, target: targetIn('<a>not a link</a>', 'a') }, true)).toBe(true);
    expect(ownsContextMenu({ ...PLAIN, target: targetIn('<div contenteditable="false">x</div>', 'div') }, true)).toBe(
      true,
    );
  });

  it('leaves a keyboard raised contextmenu to the key handler', () => {
    expect(ownsContextMenu({ ...PLAIN, fromKeyboard: true }, true)).toBe(false);
  });

  it("is not the table's for a row with no actions", () => {
    expect(ownsContextMenu(PLAIN, false)).toBe(false);
  });

  it('copes with an event that has no target', () => {
    expect(ownsContextMenu({ ...PLAIN, target: null }, true)).toBe(true);
  });
});
