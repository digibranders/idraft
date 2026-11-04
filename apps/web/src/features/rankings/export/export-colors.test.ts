// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { readWorkbookColors } from './export-colors';

afterEach(() => document.documentElement.classList.remove('dark'));

describe('readWorkbookColors', () => {
  it('leaves the page in the dark theme when it was in it', () => {
    document.documentElement.classList.add('dark');
    readWorkbookColors();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('leaves the page in the light theme when it was in it', () => {
    readWorkbookColors();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('gives an empty color where no stylesheet is loaded, so the workbook keeps the sheet’s own', () => {
    expect(Object.values(readWorkbookColors()).every((color) => color === '')).toBe(true);
  });
});
