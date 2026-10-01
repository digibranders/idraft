import { describe, expect, it } from 'vitest';

import { textLength } from './length';

describe('textLength', () => {
  it('counts characters as the API does, so an emoji is one', () => {
    expect(textLength('a😀b')).toBe(3);
    expect('a😀b'.length).toBe(4);
    expect(textLength('')).toBe(0);
  });
});
