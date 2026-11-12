import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from './csv-write';

describe('downloadBlob', () => {
  const names: string[] = [];
  beforeEach(() => {
    names.length = 0;
    URL.createObjectURL = (): string => 'blob:csv';
    URL.revokeObjectURL = vi.fn();
    // jsdom does not follow a download link: the link's name is what the browser would save the file as
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('hands the file to the browser under its name and leaves no link behind', () => {
    downloadBlob(new Blob(['x']), 'prompts.csv');
    expect(names).toEqual(['prompts.csv']);
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
