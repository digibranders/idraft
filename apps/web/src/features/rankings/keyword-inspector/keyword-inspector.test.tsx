import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DETAIL, TERM_ASSIGNMENTS } from './inspector-queries';
import { mockId } from '@/mocks/mock-ids';
import { invalidField, mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { keywordsIn, loadedGrid, rankingsAs as as, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the chart's frame, legend and table view are what these tests read
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

/** The query strings the screen wrote, newest last. */
function urlWrites(): { onUrlUpdate: (event: UrlUpdateEvent) => void; latest: () => URLSearchParams } {
  const writes: string[] = [];
  return {
    onUrlUpdate: (event) => writes.push(event.queryString),
    latest: () => new URLSearchParams(writes.at(-1) ?? ''),
  };
}

/** How many times the list of keywords (not its poll, not its count) was read. */
function countListReads(): () => number {
  let reads = 0;
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.endsWith('/tracked-keywords')) return;
    if (url.searchParams.get('limit') === '1' || url.searchParams.get('sort') === '-created_at') return;
    reads += 1;
  });
  return () => reads;
}

/** The Priority cell of a keyword's row in the grid. */
function priorityInRow(keyword: string): string | undefined {
  const grid = screen.getByRole('grid', { name: 'Tracked keywords' });
  const header = within(grid)
    .getAllByRole('rowheader')
    .find((cell) => cell.querySelector('.truncate')?.textContent === keyword);
  const row = header?.closest('[role="row"]');
  if (row === null || row === undefined) return undefined;
  const columns = within(grid)
    .getAllByRole('columnheader')
    .map((column) => column.textContent ?? '');
  const index = columns.findIndex((name) => /^Priority/.test(name));
  return [...row.children][index]?.textContent ?? undefined;
}

const inspectorOf = (keyword: string): Promise<HTMLElement> =>
  screen.findByRole('complementary', { name: keyword }, { timeout: 3000 });
const section = (inspector: HTMLElement, title: string): HTMLElement => {
  const heading = within(inspector).getByRole('heading', { level: 3, name: title });
  const card = heading.closest('section');
  if (card === null) throw new Error(`No section ${title}`);
  return card;
};

/** Opens a keyword from its row, the way a person does: a click on the keyword. */
async function openFromRow(
  user: ReturnType<typeof renderWithProviders>['user'],
  keyword: string,
): Promise<HTMLElement> {
  const grid = await loadedGrid();
  const cell = within(grid)
    .getAllByRole('rowheader')
    .find((header) => header.querySelector('.truncate')?.textContent === keyword);
  if (cell === undefined) throw new Error(`No row for ${keyword}`);
  await user.click(cell);
  return inspectorOf(keyword);
}

describe('The keyword inspector', () => {
  it('opens from a row with the keyword’s scope, metrics, months, settings and history', async () => {
    const url = urlWrites();
    const { user, container } = renderWithProviders(as('viewer'), { onUrlUpdate: url.onUrlUpdate });
    const inspector = await openFromRow(user, 'seo agency');
    await waitFor(() => expect(url.latest().get('inspect')).toMatch(/^keyword:/));
    expect(within(inspector).getByText('United States · Desktop')).toBeInTheDocument();
    expect(within(inspector).getByText('Google · English')).toBeInTheDocument();
    expect(within(inspector).getByText('1 of 59')).toBeInTheDocument();
    const metrics = within(inspector).getByRole('group', { name: 'Metrics for this keyword' });
    expect(await within(metrics).findByText('33,100')).toBeInTheDocument();
    expect(within(metrics).getByText('$24.10')).toBeInTheDocument();
    expect(within(metrics).getByText('High competition')).toBeInTheDocument();
    expect(await within(inspector).findByText(/^12 months · DataForSEO Labs/)).toBeInTheDocument();
    const tracking = section(inspector, 'Tracking');
    expect(within(tracking).getByText('1, highest')).toBeInTheDocument();
    expect(await within(section(inspector, 'Configuration history')).findByText('Version 1')).toBeInTheDocument();
    // A viewer reads: no Edit, and no action of the keyword in the More menu
    expect(within(inspector).queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    // The whole screen with an open inspector, then axe over all of it: slow when the suite runs in parallel
  }, 15_000);

  it('steps with J and K in the table’s order', async () => {
    const { user } = renderWithProviders(as('viewer'));
    await openFromRow(user, 'seo agency');
    await user.keyboard('j');
    const next = await inspectorOf('backlink checker');
    expect(within(next).getByText('2 of 59')).toBeInTheDocument();
    await user.keyboard('k');
    expect(await inspectorOf('seo agency')).toBeInTheDocument();
  });

  it('saves the tracking settings in place, and the row follows', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'Edit Tracking' }));
    const tracking = section(inspector, 'Tracking');
    await user.type(within(tracking).getByRole('textbox', { name: /Target URL/ }), 'not a url');
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    expect(await within(tracking).findByText(/starts with http/)).toBeInTheDocument();
    await user.clear(within(tracking).getByRole('textbox', { name: /Target URL/ }));
    await user.type(within(tracking).getByRole('textbox', { name: /Target URL/ }), 'https://fynix.io/agency');
    await user.click(within(tracking).getByRole('combobox', { name: 'Priority' }));
    await user.click(await screen.findByRole('option', { name: '3' }));
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    expect(within(section(inspector, 'Tracking')).getByText('https://fynix.io/agency')).toBeInTheDocument();
    expect(within(section(inspector, 'Tracking')).getByText('3')).toBeInTheDocument();
    // A new target URL starts a configuration version
    expect(await within(section(inspector, 'Configuration history')).findByText('Version 2')).toBeInTheDocument();
  });

  it('shows a saved value in the keyword’s row without reading the whole list again', async () => {
    const listReads = countListReads();
    const { user } = renderWithProviders(as('editor'), { searchParams: '?cols=keyword,priority' });
    const inspector = await openFromRow(user, 'seo agency');
    const before = listReads();
    expect(priorityInRow('seo agency')).toBe('1');
    await user.click(within(inspector).getByRole('button', { name: 'Edit Tracking' }));
    await user.click(within(section(inspector, 'Tracking')).getByRole('combobox', { name: 'Priority' }));
    await user.click(await screen.findByRole('option', { name: '3' }));
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    await waitFor(() => expect(priorityInRow('seo agency')).toBe('3'));
    expect(listReads()).toBe(before);
  });

  it('reads the list again when the saved keyword no longer matches its filters', async () => {
    const listReads = countListReads();
    const { user } = renderWithProviders(as('editor'), { searchParams: '?prio=..1' });
    const inspector = await openFromRow(user, 'seo agency');
    const before = listReads();
    await user.click(within(inspector).getByRole('button', { name: 'Edit Tracking' }));
    await user.click(within(section(inspector, 'Tracking')).getByRole('combobox', { name: 'Priority' }));
    await user.click(await screen.findByRole('option', { name: '3' }));
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    // The filter says priority 1 at most: the row is gone from the list, which was read again
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    await waitFor(() =>
      expect(keywordsIn(screen.getByRole('grid', { name: 'Tracked keywords' }))).not.toContain('seo agency'),
    );
  });

  it('asks before it leaves a keyword with unsaved changes', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'Edit Tracking' }));
    await user.type(within(inspector).getByRole('textbox', { name: /Target URL/ }), 'https://fynix.io/x');
    await user.click(within(inspector).getByRole('button', { name: 'Close' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(within(question).getByRole('button', { name: 'Keep editing' }));
    expect(within(inspector).getByRole('textbox', { name: /Target URL/ })).toHaveValue('https://fynix.io/x');
    await user.click(within(inspector).getByRole('button', { name: /^Next keyword/ }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).getByRole('button', {
        name: 'Discard changes',
      }),
    );
    const next = await inspectorOf('backlink checker');
    expect(within(next).queryByRole('textbox', { name: /Target URL/ })).toBeNull();
  });

  it('files the keyword in groups and terms', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    const links = section(inspector, 'Groups and tags');
    expect(within(links).getByText('In no group')).toBeInTheDocument();
    await user.click(await within(links).findByRole('button', { name: 'Edit Groups and tags' }));
    await user.type(within(links).getByRole('combobox', { name: 'Groups' }), 'Brand');
    await user.click(await screen.findByRole('option', { name: 'Brand' }));
    // The list stays open for more choices; Escape closes it and leaves the inspector open
    await user.keyboard('{Escape}');
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    expect(within(section(inspector, 'Groups and tags')).getByText('Brand')).toBeInTheDocument();
  });

  it('leaves a competitor out for this keyword', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    const competitors = section(inspector, 'Competitors');
    expect(await within(competitors).findByText('Rankforge')).toBeInTheDocument();
    await user.click(within(competitors).getByRole('button', { name: 'Edit Competitors' }));
    await user.click(within(competitors).getByRole('checkbox', { name: 'Rankforge' }));
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    expect(
      await within(section(inspector, 'Competitors')).findByText(/Left out for this keyword: Rankforge/),
    ).toBeInTheDocument();
  });

  it('changes the depth profile through its dialog, with the reason in the history', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'More actions for seo agency' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change depth profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change depth profile' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Depth profile' }));
    await user.click(await screen.findByRole('option', { name: 'Deep' }));
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Competitive term');
    await user.click(within(dialog).getByRole('button', { name: 'Change depth' }));
    expect(await screen.findByText('Depth profile changed')).toBeInTheDocument();
    const history = section(inspector, 'Configuration history');
    expect(await within(history).findByText('Reason: Competitive term')).toBeInTheDocument();
    expect(within(inspector).getByText('Depth: Deep')).toBeInTheDocument();
  });

  it('returns focus to the inspector’s More actions button when the depth dialog is cancelled', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'More actions for seo agency' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change depth profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change depth profile' });
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change depth profile' })).toBeNull());
    expect(within(inspector).getByRole('button', { name: 'More actions for seo agency' })).toHaveFocus();
  });

  it('offers the depth profiles the API takes, and not the one a later step builds', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'More actions for seo agency' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change depth profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change depth profile' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Depth profile' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent ?? '');
    expect(options.some((text) => text.startsWith('Deep'))).toBe(true);
    expect(options.some((text) => /Until own match/.test(text))).toBe(false);
  });

  it('puts a depth profile the API does not offer yet on the field, not in a general failure', async () => {
    server.use(
      http.patch(mswPath(DETAIL), ({ request }) =>
        invalidField(request, 'depth_profile', 'depth_profile_not_available', 'Not available yet.'),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'More actions for seo agency' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change depth profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change depth profile' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Depth profile' }));
    await user.click(await screen.findByRole('option', { name: /^Deep/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Change depth' }));
    expect(
      await within(dialog).findByText('This depth profile is not available yet. Choose another.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/could not be saved/i)).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Change depth profile' })).toBeInTheDocument();
  });

  it('archives the keyword with an undo', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'More actions for seo agency' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive keyword' }));
    expect(await screen.findByText('1 keyword archived')).toBeInTheDocument();
    // It left the active list, so the inspector says the filters hide it
    expect(await within(inspector).findByText('Hidden by the current filters')).toBeInTheDocument();
    expect(within(inspector).getByText('Archived')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('1 keyword unarchived')).toBeInTheDocument();
    await waitFor(() => expect(within(inspector).queryByText('Archived')).toBeNull());
  });

  it('says what to do when archiving fails: try again', async () => {
    server.use(http.patch(mswPath(DETAIL), () => new HttpResponse('Bad gateway', { status: 502 })));
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'More actions for seo agency' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive keyword' }));
    expect((await screen.findAllByText('The keyword was not archived')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Try again.').length).toBeGreaterThan(0);
  });

  it('keeps focus through edit mode: into the first field, then back to Edit', async () => {
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'Edit Tracking' }));
    expect(within(inspector).getByRole('textbox', { name: /Target URL/ })).toHaveFocus();
    await user.click(within(inspector).getByRole('button', { name: 'Cancel' }));
    expect(await within(inspector).findByRole('button', { name: 'Edit Tracking' })).toHaveFocus();
  });

  it('asks nothing for an action that would not leave the keyword, and holds it while a save runs', async () => {
    server.use(
      http.patch(mswPath(DETAIL), async () => {
        await delay(400);
      }),
    );
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.click(within(inspector).getByRole('button', { name: 'Edit Tracking' }));
    await user.type(within(inspector).getByRole('textbox', { name: /Target URL/ }), 'https://fynix.io/x');
    // The row already open, and Previous on the first keyword, go nowhere
    await user.click(screen.getAllByRole('rowheader')[0] ?? inspector);
    await user.keyboard('k');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    // J during the save stays on the keyword, which then leaves edit mode with the value saved
    await user.keyboard('j');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(within(inspector).queryByRole('button', { name: 'Save' })).toBeNull());
    expect(screen.getByRole('complementary', { name: 'seo agency' })).toBeInTheDocument();
    expect(within(inspector).getByText('https://fynix.io/x')).toBeInTheDocument();
  });

  it('says the keyword is hidden when the search leaves it out of the table', async () => {
    const { user } = renderWithProviders(as('viewer'));
    const inspector = await openFromRow(user, 'seo agency');
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'agentur');
    expect(await within(inspector).findByText('Hidden by the current filters')).toBeInTheDocument();
  });

  it('says when only some of the groups and tags were saved', async () => {
    server.use(
      http.post(mswPath(TERM_ASSIGNMENTS), ({ request }) => problem(request, 'rate_limited', { retry_after: 30 })),
    );
    const { user } = renderWithProviders(as('editor'));
    const inspector = await openFromRow(user, 'seo agency');
    const links = section(inspector, 'Groups and tags');
    await user.click(await within(links).findByRole('button', { name: 'Edit Groups and tags' }));
    await user.type(within(links).getByRole('combobox', { name: 'Groups' }), 'Brand');
    await user.click(await screen.findByRole('option', { name: 'Brand' }));
    await user.keyboard('{Escape}');
    await user.click(within(links).getByRole('button', { name: 'Remove SEO' }));
    await user.click(within(inspector).getByRole('button', { name: 'Save' }));
    expect(
      await within(links).findByText('Some of the changes were saved and some were not. Save again to finish.'),
    ).toBeInTheDocument();
  });

  it('names the inspector of a keyword that is not known by its type, and focuses that title, never an empty one', async () => {
    renderWithProviders(as('viewer'), { searchParams: `?inspect=keyword:${mockId('tracked', 9999)}` });
    const inspector = await screen.findByRole('complementary', { name: 'Keyword' });
    expect(within(inspector).getByRole('heading', { level: 2, name: 'Keyword' })).toHaveFocus();
  });

  it('gives a keyword that did not load a reason that is true when nothing else is shown', async () => {
    server.use(http.get(mswPath(DETAIL), () => new HttpResponse('Bad gateway', { status: 502 })));
    renderWithProviders(as('viewer'), { searchParams: `?inspect=keyword:${mockId('tracked', 9999)}` });
    const inspector = await screen.findByRole('complementary', { name: 'Keyword' });
    expect(
      await within(inspector).findByText('This keyword did not load', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(within(inspector).getByText('The server did not answer. Try again in a moment.')).toBeInTheDocument();
    expect(within(inspector).queryByText(/rest of the keyword/)).toBeNull();
  }, 10_000);

  it('says so when the keyword of a link does not exist', async () => {
    renderWithProviders(as('viewer'), { searchParams: `?inspect=keyword:${mockId('tracked', 9999)}` });
    expect(
      await screen.findByText('This keyword does not exist or you do not have access to it.', undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
  });

  it('shows rank history with own and competitor series, table view, pending empty state, and error handling', async () => {
    const { user } = renderWithProviders(as('viewer'));
    const inspector = await openFromRow(user, 'seo agency');
    const historyHeading = within(inspector).getByRole('heading', { level: 3, name: 'Rank history' });
    const historyCard = historyHeading.closest('section');
    expect(historyCard).not.toBeNull();
    if (!historyCard) throw new Error('Rank history section not found');
    expect(within(historyCard).getByText(/^Last 90 days · \d+ checks, \d+ ranked/)).toBeInTheDocument();

    expect(within(historyCard).getByRole('img', { name: 'Rank history' })).toHaveAccessibleDescription(
      /^Organic rank of Fynix \(you\) over the last 90 days/,
    );

    await user.click(within(historyCard).getByRole('button', { name: 'Table' }));
    const table = within(historyCard).getByRole('table', { name: 'Rank history' });
    expect(within(table).getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Fynix (you)' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
  });

  it('shows empty state for a pending keyword without rank checks', async () => {
    const { user } = renderWithProviders(as('viewer'));
    const inspector = await openFromRow(user, 'generative engine optimization');
    expect(await within(inspector).findByText('No checks yet')).toBeInTheDocument();
    expect(within(inspector).getByText('The rank history fills in after the first check.')).toBeInTheDocument();
  });

  it('shows error state with Try again on rank history read failure', async () => {
    const RANK_HISTORY_PATH = mswPath(
      '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/rank-history',
    );
    server.use(
      http.get(RANK_HISTORY_PATH, () =>
        HttpResponse.json({ code: 'query_timeout', title: 'Timeout' }, { status: 503 }),
      ),
    );

    const { user } = renderWithProviders(as('viewer'));
    const inspector = await openFromRow(user, 'seo agency');
    expect(await within(inspector).findByText(/The rank history did not load/)).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
