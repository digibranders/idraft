import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Controlled } from '@/test/import-harness';
import { loadedGrid, rankingsAs, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));

/** How often the import dialog's code was loaded: a module factory runs when the module is first imported. */
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('./import-dialog', () => {
  loaded.count += 1;
  return {
    ImportDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Import keywords" /> : null),
  };
});

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

// The code loads once for the page, so the steps of one test follow each other: not loaded for a viewer, not
// loaded while the dialog stays closed, loaded when it opens
describe('The import dialog’s code', () => {
  it('is loaded only when a member who can import opens the dialog', async () => {
    const viewer = renderWithProviders(rankingsAs('viewer', undefined, { importOpen: true }));
    await loadedGrid();
    expect(screen.queryByRole('dialog', { name: 'Import keywords' })).toBeNull();
    expect(loaded.count).toBe(0);
    viewer.unmount();

    const { user } = renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(loaded.count).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('dialog', { name: 'Import keywords' })).toBeInTheDocument();
    expect(loaded.count).toBe(1);
  });

  it('shows the dialog at once when the address is the import’s', async () => {
    renderWithProviders(rankingsAs('editor', undefined, { importOpen: true }));
    expect(await screen.findByRole('dialog', { name: 'Import keywords' })).toBeInTheDocument();
  });
});
