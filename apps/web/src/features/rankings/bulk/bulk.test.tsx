import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import {
  answerTrackedAsMany,
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

const BULK_UPDATE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-update';
const BULK_ARCHIVE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-archive';

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

/** The JSON bodies of the writes to tracked keywords, in order, with their method and path's last part. */
function writes(): { method: string; route: string; body: unknown }[] {
  const seen: { method: string; route: string; body: unknown }[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET' || !request.url.includes('/tracked-keywords')) return;
    const route = new URL(request.url).pathname.split('/').at(-1) ?? '';
    void request
      .clone()
      .text()
      .then((text) => seen.push({ method: request.method, route, body: text === '' ? null : JSON.parse(text) }));
  });
  return seen;
}

/** The query strings the screen wrote, newest last. */
function urlWrites(): { onUrlUpdate: (event: UrlUpdateEvent) => void; latest: () => URLSearchParams } {
  const changes: string[] = [];
  return {
    onUrlUpdate: (event) => changes.push(event.queryString),
    latest: () => new URLSearchParams(changes.at(-1) ?? ''),
  };
}

type User = ReturnType<typeof renderWithProviders>['user'];

/** Ticks the rows of these keywords and answers the bulk bar. */
async function choose(user: User, ...keywords: string[]): Promise<HTMLElement> {
  await loadedGrid();
  for (const keyword of keywords) await user.click(screen.getByRole('checkbox', { name: `Select ${keyword}` }));
  return screen.getByRole('group', { name: /Bulk actions/ });
}

describe('Bulk actions', () => {
  it('sets the priority of the chosen keywords, by their ids', async () => {
    const seen = writes();
    const { user, container } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency', 'backlink checker');
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Set priority' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priority for 2 keywords' });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('combobox', { name: 'Priority' }));
    await user.click(await screen.findByRole('option', { name: '2' }));
    await user.click(within(dialog).getByRole('button', { name: 'Set for 2 keywords' }));
    expect(await screen.findByText('Priority 2 set for 2 keywords')).toBeInTheDocument();
    expect(seen.at(-1)).toMatchObject({ route: 'bulk-update', body: { set: { priority: 2 } } });
    expect((seen.at(-1)?.body as { ids: string[] }).ids).toHaveLength(2);
    // The selection is spent
    await waitFor(() => expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull());
  }, 15_000);

  it('moves the chosen keywords into one group and out of the others', async () => {
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Move to group' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 1 keyword' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Group' }));
    await user.click(await screen.findByRole('option', { name: 'Brand' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move 1 keyword' }));
    expect(await screen.findByText('1 keyword moved to Brand')).toBeInTheDocument();
    const body = seen.at(-1)?.body as { add_group_ids: string[]; remove_group_ids: string[] };
    expect(body.add_group_ids).toEqual([MOCK_GROUP_IDS.brand]);
    expect(body.remove_group_ids).toHaveLength(4);
    expect(body.remove_group_ids).not.toContain(MOCK_GROUP_IDS.brand);
  });

  it('takes tags off, and checks a target URL before it sets one', async () => {
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    let bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Add tags' }));
    let dialog = await screen.findByRole('dialog', { name: 'Tags for 1 keyword' });
    await user.click(within(dialog).getByRole('radio', { name: 'Remove tags' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove from 1 keyword' }));
    expect(await within(dialog).findByText('Choose at least one tag')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('combobox', { name: 'Tags' }), 'SEO');
    await user.click(await screen.findByRole('option', { name: 'Topics: SEO' }));
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Remove from 1 keyword' }));
    expect(await screen.findByText('Tags removed from 1 keyword')).toBeInTheDocument();
    expect(seen.at(-1)?.body).toMatchObject({ remove_term_ids: [expect.any(String) as string] });

    bar = await choose(user, 'backlink checker');
    await user.click(within(bar).getByRole('button', { name: 'Set target URL' }));
    dialog = await screen.findByRole('dialog', { name: 'Target URL for 1 keyword' });
    const url = within(dialog).getByRole('textbox', { name: /Target URL/ });
    await user.type(url, 'fynix.io/backlinks');
    await user.click(within(dialog).getByRole('button', { name: 'Set for 1 keyword' }));
    expect(await within(dialog).findByText(/starts with http/)).toBeInTheDocument();
    await user.clear(url);
    await user.type(url, 'https://fynix.io/backlinks');
    await user.click(within(dialog).getByRole('button', { name: 'Set for 1 keyword' }));
    expect(await screen.findByText('Target URL set for 1 keyword')).toBeInTheDocument();
    expect(screen.getByText('1 configuration version started')).toBeInTheDocument();
  }, 15_000);

  it('archives at once with an undo, and deletes after asking with the count', async () => {
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    let bar = await choose(user, 'seo agency', 'backlink checker');
    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('2 keywords archived')).toBeInTheDocument();
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).not.toContain('seo agency'));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('2 keywords unarchived')).toBeInTheDocument();
    const archives = seen.filter((write) => write.route === 'bulk-archive').map((write) => write.body);
    expect(archives).toMatchObject([{ archive: true }, { archive: false }]);
    await waitFor(() => expect(keywordsIn(grid)).toContain('seo agency'));

    bar = await choose(user, 'seo agency', 'backlink checker');
    await user.click(within(bar).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete 2 keywords?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete 2 keywords' }));
    expect(await screen.findByText('2 keywords deleted')).toBeInTheDocument();
    const deletes = seen.filter((write) => write.route === 'bulk-delete');
    expect(deletes).toHaveLength(1);
    expect((deletes[0]?.body as { ids: string[] }).ids).toHaveLength(2);
    await waitFor(() => expect(keywordsIn(grid)).not.toContain('backlink checker'));
  }, 20_000);

  it('sends the filters for every match, and asks before archiving or deleting them', async () => {
    answerTrackedAsMany({ total: 12_000 });
    const seen = writes();
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    let bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 12,000 matching' }));
    await user.click(within(bar).getByRole('button', { name: 'Delete' }));
    const deleting = await screen.findByRole('alertdialog', { name: 'Delete 12,000 keywords?' });
    await user.click(within(deleting).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Archive 12,000 keywords?' });
    await user.click(within(confirm).getByRole('button', { name: 'Archive 12,000 keywords' }));
    await waitFor(() => expect(seen.some((write) => write.route === 'bulk-archive')).toBe(true));
    expect(seen.find((write) => write.route === 'bulk-archive')?.body).toEqual({
      filter: { is_active: true },
      archive: true,
    });
    // By filter, the archive cannot be undone by the same filter: no Undo
    expect(await screen.findByText(/archived$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  }, 20_000);

  it('unarchives in the Archived view, and says how many fit when the plan is full', async () => {
    server.use(
      http.post(mswPath(BULK_ARCHIVE), ({ request }) =>
        problem(request, 'quota_exceeded', { limit: 60, used: 59, requested: 2 }),
      ),
    );
    const { user } = renderWithProviders(as('editor'), { searchParams: '?archived=true' });
    const bar = await choose(user, 'seo meme', 'seo newsletter');
    await user.click(within(bar).getByRole('button', { name: 'Unarchive' }));
    // The error toast and its announcement say it
    expect(
      await screen.findAllByText('The plan has room for 1 more active keyword (59 of 60 used); this would add 2.'),
    ).not.toHaveLength(0);
  });

  it('says when the filters match too many keywords for one change', async () => {
    answerTrackedAsMany({ total: 25_000 });
    server.use(
      http.post(mswPath(BULK_UPDATE), ({ request }) => problem(request, 'too_many_subjects', { limit: 20_000 })),
    );
    const { user } = renderWithProviders(as('editor'));
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 25,000 matching' }));
    await user.click(within(bar).getByRole('button', { name: 'Set priority' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priority for 25,000 keywords' });
    await user.click(within(dialog).getByRole('button', { name: 'Set for 25,000 keywords' }));
    expect(
      await within(dialog).findByText(
        'The filters match more than 20,000 keywords. Narrow them, or choose the keywords.',
      ),
    ).toBeInTheDocument();
  }, 15_000);

  it('drops every match when a row is unticked or the selection cleared, and never brings a selection back', async () => {
    answerTrackedAsMany({ total: 12_000 });
    const seen = writes();
    const url = urlWrites();
    const { user } = renderWithProviders(as('editor'), { onUrlUpdate: url.onUrlUpdate });
    await loadedGrid();
    await user.click(screen.getByRole('checkbox', { name: /^Select all/ }));
    let bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 12,000 matching' }));
    // Unticking one row means the chosen rows, not every match, and never the one unticked
    await user.click(screen.getAllByRole('checkbox', { name: 'Select seo agency' })[0] ?? bar);
    bar = screen.getByRole('group', { name: /Bulk actions/ });
    expect(within(bar).queryByText(/All 12,000 matching selected/)).toBeNull();
    await user.click(within(bar).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: /^Delete/ }));
    await waitFor(() => expect(seen.some((write) => write.route === 'bulk-delete')).toBe(true));
    expect(seen.find((write) => write.route === 'bulk-delete')?.body).toHaveProperty('ids');
    // Clear with every match chosen leaves nothing chosen
    await user.click(await screen.findByRole('checkbox', { name: /^Select all/ }));
    bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 12,000 matching' }));
    await user.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull());
  }, 20_000);

  it('does not bring a selection back when the filters return to what they were', async () => {
    const { user } = renderWithProviders(as('editor'));
    await choose(user, 'seo agency');
    await user.click(screen.getByRole('radio', { name: 'Archived' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull());
    await user.click(screen.getByRole('radio', { name: 'Active' }));
    await loadedGrid();
    expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select seo agency' })).not.toBeChecked();
  });

  it('returns focus to the grid once a dialog made its change', async () => {
    const { user } = renderWithProviders(as('editor'));
    const bar = await choose(user, 'seo agency');
    await user.click(within(bar).getByRole('button', { name: 'Set priority' }));
    const dialog = await screen.findByRole('dialog', { name: 'Priority for 1 keyword' });
    await user.click(within(dialog).getByRole('button', { name: 'Set for 1 keyword' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Priority for 1 keyword' })).toBeNull());
    await waitFor(() => expect(document.activeElement?.closest('[role="grid"]')).not.toBeNull());
  });

  it('offers no choosing to a member who may not change keywords', async () => {
    renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('checkbox', { name: 'Select seo agency' })).toBeNull();
  });
});
