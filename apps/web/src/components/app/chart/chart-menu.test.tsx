import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartMenu, type ChartMenuAction } from './chart-menu';
import * as clipboard from '@/lib/dom/clipboard';
import * as csvWrite from '@/lib/csv/csv-write';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

// Nothing is copied or downloaded: the calls are what the tests read
vi.mock('@/lib/dom/clipboard', () => ({ copyText: vi.fn(() => Promise.resolve(true)) }));
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csvWrite>()),
  downloadBlob: vi.fn(),
}));

const TRIGGER = { name: 'More actions for Search volume' };

beforeEach(() => {
  vi.clearAllMocks();
});

/** Renders the menu and opens it the way a keyboard does: focus the trigger, press Enter. */
async function openMenu(actions: ChartMenuAction): Promise<ProvidedRender> {
  const view = renderWithProviders(<ChartMenu title="Search volume" fileName="volume" actions={actions} />);
  screen.getByRole('button', TRIGGER).focus();
  await view.user.keyboard('{Enter}');
  await screen.findByRole('menu');
  return view;
}

describe('ChartMenu', () => {
  it('renders no trigger when there is no action', () => {
    renderWithProviders(<ChartMenu title="Search volume" fileName="volume" actions={{}} />);
    expect(screen.queryByRole('button', TRIGGER)).toBeNull();
  });

  it('lists only the actions it is given, each with an icon', async () => {
    await openMenu({ link: 'https://app.test/x' });
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Copy link']);
    expect(screen.getByRole('menuitem', { name: 'Copy link' }).querySelector('svg')).not.toBeNull();
  });

  it('lists the three actions in order', async () => {
    await openMenu({ png: () => Promise.resolve(new Blob()), csv: () => ({ header: ['a'], rows: [] }), link: 'x' });
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Download PNG',
      'Download CSV',
      'Copy link',
    ]);
  });

  it('downloads the image under the file name, and shows a toast when saving it throws', async () => {
    const blob = new Blob(['png']);
    const { user } = await openMenu({ png: () => Promise.resolve(blob) });
    await user.click(screen.getByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => expect(csvWrite.downloadBlob).toHaveBeenCalledExactlyOnceWith(blob, 'volume.png'));
    vi.mocked(csvWrite.downloadBlob).mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    screen.getByRole('button', TRIGGER).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Download PNG' }));
    expect((await screen.findAllByText('Could not make the image of the chart')).length).toBeGreaterThan(0);
  });

  it('copies the link as given and says so', async () => {
    const { user } = await openMenu({ link: 'https://app.test/x?y=1' });
    await user.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith('https://app.test/x?y=1');
    expect((await screen.findAllByText('Link copied')).length).toBeGreaterThan(0);
  });

  it('shows a toast when the link could not be copied', async () => {
    vi.mocked(clipboard.copyText).mockResolvedValueOnce(false);
    const { user } = await openMenu({ link: 'https://app.test/x' });
    await user.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    expect((await screen.findAllByText('Could not copy the link')).length).toBeGreaterThan(0);
  });
});
