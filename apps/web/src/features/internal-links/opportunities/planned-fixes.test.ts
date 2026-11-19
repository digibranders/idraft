import { describe, expect, it } from 'vitest';

import { csvHasRows } from './planned-fixes';

describe('whether a CSV holds rows after its header', () => {
  it('is false for nothing, the header alone and the header with its line end', () => {
    expect(csvHasRows('')).toBe(false);
    expect(csvHasRows('Source URL,Target URL')).toBe(false);
    expect(csvHasRows('Source URL,Target URL\r\n')).toBe(false);
    expect(csvHasRows('﻿Source URL,Target URL\n\n')).toBe(false);
  });

  it('is true when a row follows, even one with a quoted line break', () => {
    expect(csvHasRows('Source URL,Target URL\na,b\n')).toBe(true);
    expect(csvHasRows('Source URL,Context\r\na,"one\ntwo"\r\n')).toBe(true);
  });
});
