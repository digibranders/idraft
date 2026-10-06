import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DETAIL } from '../keyword-inspector/inspector-queries';
import { invalid, mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import {
  cleanstart,
  keywordsIn,
  loadedGrid,
  rankingsAs as as,
  restoreWideScreen,
  stubWideScreen,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

const BULK_CREATE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-create';
const SETTINGS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/settings';

/** The query strings the screen wrote, newest last. */
function urlWrites(): { onUrlUpdate: (event: UrlUpdateEvent) => void; latest: () => URLSearchParams } {
  const writes: string[] = [];
  return {
    onUrlUpdate: (event) => writes.push(event.queryString),
    latest: () => new URLSearchParams(writes.at(-1) ?? ''),
  };
}

async function openDialog(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
  await loadedGrid();
  await user.click(screen.getByRole('button', { name: 'Add keywords' }));
  return screen.findByRole('dialog', { name: 'Add keywords' });
}

describe('Add keywords', () => {
  it('counts the list as the API reads it, names a refused line, and adds the rest', async () => {
    const { user, container } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    const keywords = within(dialog).getByRole('textbox', { name: 'Keywords' });
    await user.type(keywords, 'rank tracker api{Enter}Rank Tracker API{Enter}site:fynix.io seo');
    expect(within(dialog).getByText('1 keyword · 1 repeat left out')).toBeInTheDocument();
    // Both devices make two tracked keywords of each
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop and mobile' }));
    expect(
      within(dialog).getByText('1 keyword · 1 repeat left out · 2 tracked keywords, one per device'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await within(dialog).findByText(/^Line 3: search operators/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.clear(keywords);
    await user.type(keywords, 'rank tracker api');
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add keywords' })).toBeNull());
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).toContain('rank tracker api'));
  }, 15_000);

  it('tells a keyword that came back from deletion apart from a new one', async () => {
    server.use(
      http.post(mswPath(BULK_CREATE), () =>
        HttpResponse.json({
          data: {
            created: ['0192d1a8-e007-7a10-8e07-000000000201', '0192d1a8-e007-7a10-8e07-000000000202'],
            restored: ['0192d1a8-e007-7a10-8e07-000000000201'],
            skipped: [],
            rejected: [],
          },
        }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'old keyword{Enter}new keyword');
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 keywords' }));
    expect(await screen.findByText('2 keywords added')).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 of them was deleted before and is back with its old settings and history. The new ones get their metrics within minutes.',
      ),
    ).toBeInTheDocument();
  });

  it('says so when every keyword came back from deletion, and in the result beside keywords tracked already', async () => {
    const restoredId = '0192d1a8-e007-7a10-8e07-000000000201';
    let skip = false;
    server.use(
      http.post(mswPath(BULK_CREATE), () =>
        HttpResponse.json({
          data: {
            created: [restoredId],
            restored: [restoredId],
            skipped: skip ? [{ index: 1, existing_id: '0192d1a8-e007-7a10-8e07-000000000001' }] : [],
            rejected: [],
          },
        }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    let dialog = await openDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'old keyword');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    // No new keywords: nothing is said about new ones' metrics
    expect(
      await screen.findByText('1 of them was deleted before and is back with its old settings and history.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add keywords' })).toBeNull());
    skip = true;
    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    dialog = await screen.findByRole('dialog', { name: 'Add keywords' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'old keyword{Enter}seo agency');
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 keywords' }));
    const result = await screen.findByRole('dialog', { name: 'Keywords added' });
    expect(
      within(result).getByText('1 of them was deleted before and is back with its old settings and history.'),
    ).toBeInTheDocument();
  }, 15_000);

  it('says by how much an add goes over the plan’s keyword limit', async () => {
    server.use(
      http.post(mswPath(BULK_CREATE), ({ request }) =>
        problem(request, 'quota_exceeded', { limit: 2000, used: 1920, requested: 120 }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank tracker api');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(
      await within(dialog).findByText(
        'Your plan has room for 80 more active keywords (1,920 of 2,000 used); this adds 120.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the keywords tracked already, and unarchives an archived one', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    // At the project's location (Germany, English, desktop) "seo meme" is archived and "keyword research" active
    expect(within(dialog).getByRole('combobox', { name: /^Location/ })).toHaveValue('Germany');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Keywords' }),
      'seo meme{Enter}keyword research{Enter}rank api',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add 3 keywords' }));
    const result = await screen.findByRole('dialog', { name: 'Keywords added' });
    expect(within(result).getByText('1 keyword was added.')).toBeInTheDocument();
    expect(await within(result).findByText('seo meme · Desktop')).toBeInTheDocument();
    expect(within(result).getByText('Archived')).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Unarchive: seo meme · Desktop' }));
    expect(await within(result).findByText('Unarchived')).toBeInTheDocument();
    // The button that worked is gone; its row's "Show it" holds the focus
    expect(within(result).getByRole('button', { name: 'Show it: seo meme · Desktop' })).toHaveFocus();
    await user.click(within(result).getByRole('button', { name: 'Show it: keyword research · Desktop' }));
    expect(
      await screen.findByRole('complementary', { name: 'keyword research' }, { timeout: 3000 }),
    ).toBeInTheDocument();
  }, 15_000);

  it('opens an archived keyword tracked already in the archived view, and says when unarchiving finds no room', async () => {
    server.use(
      http.patch(mswPath(DETAIL), ({ request }) =>
        problem(request, 'quota_exceeded', { limit: 60, used: 60, requested: 1 }),
      ),
    );
    const url = urlWrites();
    const { user } = renderWithProviders(as('editor'), { onUrlUpdate: url.onUrlUpdate });
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'seo meme');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    const result = await screen.findByRole('dialog', { name: 'No keywords added' });
    await user.click(await within(result).findByRole('button', { name: 'Unarchive: seo meme · Desktop' }));
    expect(
      await within(result).findByText('Your plan has no room for another active keyword (60 of 60 used); this adds 1.'),
    ).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Show it: seo meme · Desktop' }));
    await waitFor(() => expect(url.latest().get('archived')).toBe('true'));
    expect(url.latest().get('inspect')).toMatch(/^keyword:/);
  }, 15_000);

  it('names the line of a keyword the API refuses, and counts too long a list', async () => {
    server.use(
      http.post(mswPath(BULK_CREATE), ({ request }) =>
        invalid(request, [
          { location: 'body', path: 'items.1.keyword', code: 'keyword_too_long', message: 'Too long.' },
        ]),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    const keywords = within(dialog).getByRole('textbox', { name: 'Keywords' });
    await user.type(keywords, 'first{Enter}{Enter}second');
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 keywords' }));
    // The second keyword is on line 3, after a blank line
    expect(await within(dialog).findByText('Line 3: use at most 700 characters')).toBeInTheDocument();
    await user.clear(keywords);
    await user.click(keywords);
    await user.paste(Array.from({ length: 1001 }, (_, index) => `keyword ${String(index)}`).join('\n'));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1,001 keywords' }));
    expect(
      await within(dialog).findByText('Add at most 1,000 keywords at a time. This list has 1,001.'),
    ).toBeInTheDocument();
  }, 15_000);

  it('starts on the project’s default device, and starts over when opened again', async () => {
    server.use(
      http.get(mswPath(SETTINGS), () =>
        HttpResponse.json({
          data: {
            version: 1,
            entity_config_version: 1,
            seo: {
              default_device: 'both',
              default_depth_profile: 'standard',
              default_frequency: 'daily',
              visibility_volume_mode: 'annual_average',
              visibility_weight_scheme: 'uniform',
            },
          },
        }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    let dialog = await openDialog(user);
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Desktop and mobile' })).toBeChecked());
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank api');
    await user.click(within(dialog).getByRole('radio', { name: 'Mobile' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add keywords' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    dialog = await screen.findByRole('dialog', { name: 'Add keywords' });
    expect(within(dialog).getByRole('textbox', { name: 'Keywords' })).toHaveValue('');
    expect(within(dialog).getByRole('radio', { name: 'Desktop and mobile' })).toBeChecked();
  }, 15_000);

  it('is offered where the project tracks nothing yet, and not to a viewer', async () => {
    const { unmount } = renderWithProviders(as('editor', cleanstart.project_id));
    const empty = await screen.findByRole('heading', { name: 'No keywords tracked yet' });
    const state = empty.parentElement?.parentElement ?? document.body;
    expect(within(state).getByRole('button', { name: 'Add keywords' })).toBeInTheDocument();
    unmount();
    renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('button', { name: 'Add keywords' })).toBeNull();
  });
});
