import { describe, expect, it, vi } from 'vitest';

import { downloadUrl } from './download';

describe('downloadUrl', () => {
  it('clicks a temporary link with the file name, then removes it', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadUrl('/api/v1/report', 'keywords-report.csv');
    expect(click).toHaveBeenCalledOnce();
    const link = click.mock.contexts[0];
    if (!(link instanceof HTMLAnchorElement)) throw new Error('The click did not come from a link');
    expect(link.getAttribute('href')).toBe('/api/v1/report');
    expect(link.download).toBe('keywords-report.csv');
    expect(document.body.contains(link)).toBe(false);
    click.mockRestore();
  });
});
