import { describe, expect, it } from 'vitest';

import messages from '../../messages/en.json';

type Tree = { readonly [key: string]: string | Tree };

function entries(tree: Tree, prefix = ''): [key: string, text: string][] {
  return Object.entries(tree).flatMap(([name, value]) =>
    typeof value === 'string' ? [[`${prefix}${name}`, value] as [string, string]] : entries(value, `${prefix}${name}.`),
  );
}

const all = entries(messages);
const failing = (test: (text: string) => boolean): string[] => all.filter(([, text]) => test(text)).map(([key]) => key);
// Built from code points, so this file does not contain the characters it looks for: figure dash,
// en-dash, em-dash and horizontal bar.
const dashes = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]`);

describe('message catalog (22-content-formatting.md section 1)', () => {
  it('has messages', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('has no empty message and no stray space around one', () => {
    expect(failing((text) => text.trim() === '' || text !== text.trim())).toEqual([]);
  });

  it('has no dash used as punctuation, as a character or as a spaced hyphen', () => {
    expect(failing((text) => dashes.test(text) || / - /.test(text))).toEqual([]);
  });

  it('has no double space', () => {
    expect(failing((text) => / {2,}/.test(text))).toEqual([]);
  });

  it('has no exclamation mark: the voice is neutral', () => {
    expect(failing((text) => text.includes('!'))).toEqual([]);
  });

  it('names keys in camelCase', () => {
    expect(
      all.map(([key]) => key).filter((key) => !key.split('.').every((part) => /^[a-z][A-Za-z0-9]*$/.test(part))),
    ).toEqual([]);
  });
});
