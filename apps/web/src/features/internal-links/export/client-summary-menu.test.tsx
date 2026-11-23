import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadHtml } from '@/lib/api/download';
import { HISTORY_RUN_IDS } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

// The real file save needs a browser; the test reads what the screen hands it
vi.mock('@/lib/api/download', async (original) => ({
  ...(await original<typeof import('@/lib/api/download')>()),
  downloadHtml: vi.fn(),
}));

const FLOW = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/tier-flow');
const PROBLEM = { 'content-type': 'application/problem+json' };

beforeEach(() => {
  stubWideScreen();
  vi.mocked(downloadHtml).mockReset();
});
afterEach(() => {
  server.events.removeAllListeners();
  restoreWideScreen();
});

const openExport = async (user: ReturnType<typeof renderWithProviders>['user']): Promise<void> => {
  await user.click(await screen.findByRole('button', { name: 'Export' }));
};

describe('Client summary (HTML) in the Export menu', () => {
  it('saves the page once under its file name and says so', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await openExport(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Client summary (HTML)' }));
    await waitFor(() => expect(downloadHtml).toHaveBeenCalledTimes(1));
    expect(downloadHtml).toHaveBeenCalledWith(
      expect.stringContaining('eventussecurity.com'),
      'internal-links-summary.html',
    );
    expect(await screen.findByText('Client summary ready')).toBeInTheDocument();
  });

  it('waits for the page being made: one build, the entry reads Preparing the summary and is disabled', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let flowReads = 0;
    server.use(
      http.get(FLOW, async () => {
        flowReads += 1;
        await held;
        return HttpResponse.json({
          data: { cells: [], run_id: HISTORY_RUN_IDS[0], scope: 'editorial', stale: false, tiers: [] },
        });
      }),
    );
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    await openExport(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Client summary (HTML)' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    const waiting = await screen.findByRole('menuitem', { name: /Preparing the summary/ });
    expect(waiting).toHaveAttribute('aria-disabled', 'true');
    expect(flowReads).toBe(1);
    release();
    await waitFor(() => expect(downloadHtml).toHaveBeenCalledTimes(1));
  });

  it('toasts the failure in the API own words and saves nothing', async () => {
    server.use(
      http.get(FLOW, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Broken',
            status: 500,
            code: 'internal_error',
            detail: 'The tiers could not be read.',
          },
          { status: 500, headers: PROBLEM },
        ),
      ),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await openExport(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Client summary (HTML)' }));
    // The toast is also spoken in a live region, so the text is on the page twice
    expect(await screen.findAllByText('The client summary could not be made')).not.toHaveLength(0);
    expect(screen.getAllByText('The tiers could not be read.')).not.toHaveLength(0);
    expect(downloadHtml).not.toHaveBeenCalled();
  });

  it('is disabled with its reason when the address names a crawl that cannot be shown', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?run=0192e4a0-1000-7000-8000-0000000000ee',
    });
    await openExport(user);
    const entry = await screen.findByRole('menuitem', { name: 'Client summary (HTML)' });
    expect(entry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('There is no crawl to summarise yet.')).toBeInTheDocument();
  });
});

describe('Share link in the Export menu', () => {
  it('opens the dialog for an editor, who can create a link', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await openExport(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Share link' }));
    expect(await screen.findByRole('dialog', { name: 'Share link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create link' })).toBeInTheDocument();
  });

  it('opens it for a viewer too, without the create button', async () => {
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    await openExport(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Share link' }));
    expect(await screen.findByRole('dialog', { name: 'Share link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
  });
});
