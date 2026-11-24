import { screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const TIERS = mswPath('/api/v1/workspaces/{workspace_id}/page-tiers');

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

/** Renders the default Pages view and fails when React reports a render loop. */
async function renderDefaultPages(): Promise<void> {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByRole('grid', { name: 'Pages' })).toBeInTheDocument();
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/Maximum update depth/);
  } finally {
    errors.mockRestore();
  }
}

describe('the Pages tab does not loop on renders', () => {
  it('renders the default view while the workspace tiers have not answered', async () => {
    server.use(
      http.get(TIERS, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await renderDefaultPages();
  });

  it('renders the default view when the workspace has no tiers', async () => {
    server.use(http.get(TIERS, () => HttpResponse.json({ data: [], page: { has_more: false, next_cursor: null } })));
    await renderDefaultPages();
  });
});
