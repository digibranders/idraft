import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadedGrid, rankingsAs, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

const saved: Blob[] = [];
const names: string[] = [];

beforeEach(() => {
  stubWideScreen();
  saved.length = 0;
  names.length = 0;
  URL.createObjectURL = (blob: Blob | MediaSource): string => {
    saved.push(blob as Blob);
    return 'blob:export';
  };
  URL.revokeObjectURL = vi.fn();
  // jsdom does not follow a download link: the link's name is what the browser would save the file as
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
});
afterEach(() => {
  restoreWideScreen();
  vi.restoreAllMocks();
});

describe('Export', () => {
  it('saves the table as CSV from the Export menu, one row for each keyword with its rank on the device shown', async () => {
    const { user } = renderWithProviders(rankingsAs('viewer'));
    await loadedGrid();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'CSV, table only' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(names[0]).toMatch(/^keywords-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await (saved[0] as Blob).text();
    expect(text.split('\r\n')[0]).toContain('Keyword,Rank (Desktop),Ranking URL');
    expect(text.split('\r\n').length).toBeGreaterThan(5);
  });

  it('saves a workbook with the summary from the same menu, for a viewer too', async () => {
    const { user } = renderWithProviders(rankingsAs('viewer'));
    await loadedGrid();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Excel workbook with summary' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(names[0]).toMatch(/\.xlsx$/);
    const bytes = new Uint8Array(await (saved[0] as Blob).arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });
});
