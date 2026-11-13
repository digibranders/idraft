import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { metaLine } from './meta-line';

// Built from code points, so this file does not contain the characters it looks for.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

describe('metaLine', () => {
  it('joins the facts with a middle dot, freshness first', () => {
    expect(metaLine(['AI updated Nov 12, 02:10', '250 prompts', '3 engines'])).toBe(
      'AI updated Nov 12, 02:10 · 250 prompts · 3 engines',
    );
  });

  it('leaves out a fact that is not known and keeps the order of the rest', () => {
    expect(metaLine([null, '250 prompts', '3 engines'])).toBe('250 prompts · 3 engines');
    expect(metaLine(['AI updated Nov 12, 02:10', null, '3 engines'])).toBe('AI updated Nov 12, 02:10 · 3 engines');
  });

  it('is null when no fact is known, so the header shows no line', () => {
    expect(metaLine([null, null, null])).toBeNull();
    expect(metaLine([])).toBeNull();
  });

  it('keeps at most two middle dots, the design system rule for the meta line', () => {
    const line = metaLine(['a', 'b', 'c']);
    expect(typeof line === 'string' ? line.split('·') : []).toHaveLength(3);
  });

  it('takes an element as a fact and keeps the order and the dots', () => {
    const line = metaLine([createElement('time', null, 'Nov 12'), '250 prompts', null, '3 engines']);
    expect(renderToStaticMarkup(createElement('p', null, line))).toBe(
      '<p><time>Nov 12</time> · 250 prompts · 3 engines</p>',
    );
  });

  it('writes no em-dash or en-dash', () => {
    expect(metaLine(['a', 'b', 'c'])).not.toMatch(DASHES);
  });
});
