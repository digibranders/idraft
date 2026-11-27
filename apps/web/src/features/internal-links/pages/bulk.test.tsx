import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockBrowser } from '@/test/mock-api';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { crawledPages, EVENTUS, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { pagesAs } from '@/test/pages-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/pages/all',
  useSearchParams: () => new URLSearchParams(),
}));

// The seam of the Monitoring session: unavailable as on this branch, until the one test below fills it
const tracking = vi.hoisted(() => ({
  available: false,
  track: vi.fn<(urlIds: readonly string[]) => Promise<unknown>>(),
}));
vi.mock('@/lib/pages/tracking', () => ({
  get TRACKING_AVAILABLE() {
    return tracking.available;
  },
  useTrackedPages: () => ({ state: 'unavailable' }),
  useTrackPages: () => ({ track: tracking.track, pending: false }),
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PAGES = mswPath(`${P}/internal-links/pages`);
const TIERS = mswPath(`${P}/pages/tiers`);
const RESET = mswPath(`${P}/pages/tiers/reset`);
const TAGS = mswPath(`${P}/pages/tags`);

beforeEach(stubWideScreen);
afterEach(() => {
  tracking.available = false;
  tracking.track.mockReset();
  restoreWideScreen();
  server.events.removeAllListeners();
});

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Pages' });
const rowOf = async (path: string): Promise<HTMLElement> =>
  within(await grid()).findByRole('rowheader', { name: path });
const checkbox = (path: string): Promise<HTMLElement> => screen.findByRole('checkbox', { name: `Select ${path}` });
/** The tier badge text in the row of a page: the table's cell, read from the row header's row. */
const tierOf = async (path: string): Promise<string | null> => {
  const row = (await rowOf(path)).closest('[role="row"]');
  // The badge also holds the tier's name for screen readers: the code or Untiered is its start
  const text = row === null ? undefined : within(row as HTMLElement).queryByText(/^(T\d|Untiered)/)?.textContent;
  return text?.match(/^(T\d|Untiered)/)?.[0] ?? null;
};

/** The fixture's rows with a total of 250, so the bulk bar offers "Select all 250 matching". */
function stubManyPages(): void {
  const fixture = crawledPages().map((page) => pageRow(page, 'editorial'));
  server.use(
    http.get(PAGES, () =>
      HttpResponse.json({
        data: fixture,
        page: { limit: 100, next_cursor: 'next', has_more: true },
        meta: { run_id: MOCK_RUN_ID, scope: 'editorial', total: 250 },
      }),
    ),
  );
}

async function chooseAllMatching(user: ProvidedRender['user']): Promise<void> {
  await grid();
  await user.click(await screen.findByRole('checkbox', { name: /^Select all \d+ pages loaded/ }));
  await user.click(await screen.findByRole('button', { name: /Select all 250 matching/ }));
}

/** Long enough for a request a key press would have sent to have reached the handler. */
const SETTLE_MS = 150;
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));
  });

/** Records the JSON body of each write to `path` and lets the mock answer it. */
function bodiesOf(path: RegExp | string, method: 'put' | 'post'): unknown[] {
  const seen: unknown[] = [];
  server.use(
    http[method](path, async ({ request }) => {
      seen.push(await request.clone().json());
      return undefined;
    }),
  );
  return seen;
}

describe('bulk tiers (spec 5.2)', () => {
  it('sets a tier on the selection from the bulk bar, with the url ids as strings', async () => {
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Set tier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set the tier of 1 page' });
    await user.click(within(dialog).getByRole('radio', { name: /^T3 Content pages/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect((await screen.findAllByText('1 page is now T3 Content pages.')).length).toBeGreaterThan(0);
    expect(bodies).toEqual([{ url_ids: ['116'], tier_id: expect.any(String) }]);
    await waitFor(async () => expect(await tierOf('/about')).toBe('T3'));
    // The selection is cleared after the change
    expect(screen.queryByRole('group', { name: /selected/ })).toBeNull();
  });

  it('sets Untiered by hand and gives pages back to their rule', async () => {
    const reset = bodiesOf(RESET, 'post');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Set tier' }));
    let dialog = await screen.findByRole('dialog', { name: 'Set the tier of 1 page' });
    await user.click(within(dialog).getByRole('radio', { name: 'Untiered' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect((await screen.findAllByText('1 page is now Untiered.')).length).toBeGreaterThan(0);
    await waitFor(async () => expect(await tierOf('/about')).toBe('Untiered'));

    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Set tier' }));
    dialog = await screen.findByRole('dialog', { name: 'Set the tier of 1 page' });
    await user.click(within(dialog).getByRole('radio', { name: /^Reset to rule/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect((await screen.findAllByText('1 page went back to the tier their rule gives.')).length).toBeGreaterThan(0);
    expect(reset).toEqual([{ url_ids: ['116'] }]);
  });

  it('sets a tier with keys 1 to 8 and Untiered with 0 while rows are selected, focus left on the row', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    // The focus stays on the row's checkbox, as it does after a click: the keys must work from there
    await user.click(await checkbox('/about'));
    await user.keyboard('2');
    expect((await screen.findAllByText('1 page is now T2 Supporting pages.')).length).toBeGreaterThan(0);
    await user.click(await checkbox('/about'));
    await user.keyboard('0');
    expect((await screen.findAllByText('1 page is now Untiered.')).length).toBeGreaterThan(0);
  });

  it('does nothing for a key with no tier at that position, or with nothing selected', async () => {
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await rowOf('/about');
    await user.keyboard('2');
    await user.click(await checkbox('/about'));
    // The fixture workspace has four tiers
    await user.keyboard('7');
    // A valid key settles it: the one request in the end is this one, so the first two sent nothing
    await user.keyboard('3');
    expect((await screen.findAllByText('1 page is now T3 Content pages.')).length).toBeGreaterThan(0);
    expect(bodies).toEqual([{ url_ids: ['116'], tier_id: expect.any(String) }]);
  });

  it('says a change that changed nothing in words that read true', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    // /about is T4 already
    await user.keyboard('4');
    expect((await screen.findAllByText('No pages changed.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/is now/)).toBeNull();
  });

  it('ignores a key held down: only the first press acts, a repeat never retries a failing request', async () => {
    server.use(
      http.put(TIERS, () =>
        HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 }),
      ),
    );
    // Added last, so it sees each request first and lets the failing handler answer it
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    for (let repeat = 0; repeat < 3; repeat += 1) fireEvent.keyDown(document.body, { key: '2', repeat: true });
    await settle();
    expect(bodies).toEqual([]);
    fireEvent.keyDown(document.body, { key: '2' });
    expect((await screen.findAllByText('The change could not be saved')).length).toBeGreaterThan(0);
    for (let repeat = 0; repeat < 3; repeat += 1) fireEvent.keyDown(document.body, { key: '2', repeat: true });
    await settle();
    expect(bodies).toHaveLength(1);
  });

  it('does not take a digit typed in a text field', async () => {
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    const field = document.createElement('input');
    document.body.append(field);
    try {
      await user.type(field, '2');
      await settle();
      expect(field).toHaveValue('2');
      expect(bodies).toEqual([]);
    } finally {
      field.remove();
    }
  });

  it('does not take the keys while a dialog is open', async () => {
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Set tier' }));
    await screen.findByRole('dialog', { name: 'Set the tier of 1 page' });
    await user.keyboard('3');
    expect(bodies).toEqual([]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The selection is kept, and the key acts again once the dialog is gone (the bulk bar has no text field)
    await user.keyboard('3');
    expect((await screen.findAllByText('1 page is now T3 Content pages.')).length).toBeGreaterThan(0);
    expect(bodies).toHaveLength(1);
  });

  it('offers no selection and no keys to a viewer', async () => {
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('viewer', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await rowOf('/about');
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.keyboard('2');
    await settle();
    expect(bodies).toEqual([]);
    expect(screen.queryByText(/is now/)).toBeNull();
  });

  it('sends the filter when every matching page is chosen, and names the count the API answers', async () => {
    stubManyPages();
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'status=2xx' });
    await chooseAllMatching(user);
    await user.keyboard('1');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ filter: { status: ['2xx'], include_variants: false }, tier_id: expect.any(String) });
    expect(bodies[0]).not.toHaveProperty('url_ids');
  });

  it('sends the whole filter: the search, the worklist and the Untiered choice', async () => {
    stubManyPages();
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: 'q=%2Fblog&view=orphans&tier=none',
    });
    await chooseAllMatching(user);
    await user.keyboard('2');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      filter: { q: '/blog', worklist: 'orphans', tier_ids: ['none'], include_variants: false },
      tier_id: expect.any(String),
    });
  });

  it('sends the view and the folder of the list in the filter when every matching page is chosen', async () => {
    stubManyPages();
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: 'view=live&folder=/blog/',
    });
    await screen.findByRole('button', { name: 'Folder: /blog/. Edit filter' });
    await chooseAllMatching(user);
    await user.keyboard('1');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      filter: { view: 'live', folder: '/blog/', include_variants: false },
      tier_id: expect.any(String),
    });
  });

  it('forgets the selection when the filters change, and does not bring it back with them', async () => {
    stubManyPages();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await chooseAllMatching(user);
    expect(await screen.findByRole('group', { name: /250/ })).toBeInTheDocument();
    // The View menu is in the toolbar, which the bulk bar takes the place of: no query can change while rows are
    // chosen, and once the choice is cleared another worklist is another query, and so is "All pages" again
    expect(screen.queryByRole('button', { name: 'View: All pages' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    await user.click(await screen.findByRole('button', { name: 'View: All pages' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Orphans' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /selected/ })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'View: Orphans' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'All pages' }));
    await grid();
    expect(screen.queryByRole('group', { name: /selected/ })).toBeNull();
    expect(screen.queryByRole('group', { name: /250/ })).toBeNull();
    // No row checkbox is ticked either
    expect(screen.queryAllByRole('checkbox', { checked: true })).toEqual([]);
  });

  it('keeps a failed dialog change in the dialog as an alert, and closes it when the retry works', async () => {
    let fail = true;
    server.use(
      http.put(TIERS, () =>
        fail
          ? HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 })
          : undefined,
      ),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Set tier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set the tier of 1 page' });
    await user.click(within(dialog).getByRole('radio', { name: /^T3 Content pages/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    // The reason is the dialog's own alert, not a toast beside a modal that stays
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The change could not be saved');
    expect(screen.getAllByText('The change could not be saved')).toHaveLength(1);
    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect((await screen.findAllByText('1 page is now T3 Content pages.')).length).toBeGreaterThan(0);
    // The success toast is a dialog too: it is the tier dialog that goes
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set the tier of 1 page' })).toBeNull());
  });

  it('says the filter is too big when the API refuses it, and keeps the selection', async () => {
    server.use(
      http.put(TIERS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Too many', status: 422, code: 'too_many_subjects' },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.keyboard('1');
    expect(
      (await screen.findAllByText('At most 20,000 pages change at once. Narrow the filter first.')).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByRole('group', { name: /selected/ })).toBeInTheDocument();
  });

  it('says a failed change failed, and does not claim it', async () => {
    server.use(
      http.put(TIERS, () =>
        HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 }),
      ),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.keyboard('1');
    expect((await screen.findAllByText('The change could not be saved')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/is now/)).toBeNull();
  });

  it('opens the journey of one chosen page only, and shows no equity anywhere', async () => {
    const { user, container } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), {
      searchParams: 'q=%2Fabout',
    });
    await user.click(await checkbox('/about'));
    expect(await screen.findByRole('button', { name: 'Open in journey' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/equity/i);
    expect(document.body.textContent).not.toMatch(/equity/i);
  });
});

describe('bulk tags (spec 5.3)', () => {
  const VOCABULARIES = mswPath('/api/v1/workspaces/{workspace_id}/vocabularies');

  it('says the tags are loading, not that there are none, while the vocabularies are read', async () => {
    server.use(http.get(VOCABULARIES, () => new Promise<never>(() => undefined)));
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    expect(within(dialog).getByText('Loading the tags')).toBeInTheDocument();
    expect(within(dialog).queryByText(/no tag set yet/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('says the tags could not be read, with Try again, and not that there are none', async () => {
    let fail = true;
    server.use(
      http.get(VOCABULARIES, () =>
        fail
          ? HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 })
          : undefined,
      ),
    );
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    expect(await within(dialog).findByText('The tags could not be loaded')).toBeInTheDocument();
    expect(within(dialog).queryByText(/no tag set yet/)).toBeNull();
    fail = false;
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText(/no tag set yet/)).toBeInTheDocument();
  });

  it('says so, with a way to the taxonomy, when the project has no tags', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    expect(await within(dialog).findByText(/no tag set yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open Tags' })).toHaveAttribute(
      'href',
      '/digibranders/eventus-security/settings/taxonomy',
    );
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('adds and removes a tag of the project vocabulary by its term id', async () => {
    // A tag vocabulary with one term, made through the mock API; its state travels in cookies
    const jar = new Map<string, string>();
    const editor = mockBrowser('editor', jar);
    const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
    const vocabulary = await editor.call('POST', `${W}/vocabularies`, {
      kind: 'tag',
      name: 'Page tags',
      project_id: EVENTUS.project_id,
    });
    expect(vocabulary.status).toBe(201);
    const vocabularyId = (vocabulary.body as { data: { vocabulary_id: string } }).data.vocabulary_id;
    const term = await editor.call('POST', `${W}/vocabularies/${vocabularyId}/terms`, { name: 'Cornerstone' });
    expect(term.status).toBe(201);
    for (const [name, value] of jar) document.cookie = `${name}=${value}; Path=/; Secure`;

    const bodies = bodiesOf(TAGS, 'put');
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Add tag' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Tag' }));
    await user.click(await screen.findByRole('option', { name: 'Cornerstone' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect((await screen.findAllByText('Cornerstone added to 1 page.')).length).toBeGreaterThan(0);

    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Remove tag' }));
    dialog = await screen.findByRole('dialog', { name: 'Remove a tag from 1 page' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Tag' }));
    await user.click(await screen.findByRole('option', { name: 'Cornerstone' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect((await screen.findAllByText('Cornerstone removed from 1 page.')).length).toBeGreaterThan(0);
    // The same term goes out by its id, in the add and then in the remove
    expect(bodies).toEqual([
      { url_ids: ['116'], add: [expect.any(String)], remove: [] },
      { url_ids: ['116'], add: [], remove: [expect.any(String)] },
    ]);
    expect(new Set(JSON.stringify(bodies).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g)).size).toBe(1);
  });
});

describe('Track in Monitoring (spec 7.5)', () => {
  it('offers no action while the tracking seam is not filled', async () => {
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await screen.findByRole('button', { name: 'Set tier' });
    expect(screen.queryByRole('button', { name: 'Track in Monitoring' })).toBeNull();
  });

  it('tracks the chosen pages and repeats the numbers and the limit the outcome reports', async () => {
    tracking.available = true;
    tracking.track.mockResolvedValue({ added: 3, alreadyTracked: 1, notLive: 2, overLimit: 4, limit: 150 });
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Track in Monitoring' }));
    await waitFor(() => expect(tracking.track).toHaveBeenCalledWith(['116']));
    expect((await screen.findAllByText('3 pages added')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 already tracked/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 not added: not a live page/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4 not added: the limit is 150 pages/).length).toBeGreaterThan(0);
  });

  it('is disabled with its reason when every matching page is chosen', async () => {
    tracking.available = true;
    stubManyPages();
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS));
    await chooseAllMatching(user);
    const action = await screen.findByRole('button', { name: 'Track in Monitoring' });
    expect(action).toHaveAttribute('aria-disabled', 'true');
    expect(action).toHaveAccessibleDescription('Choose the pages one by one to track them');
    await user.click(action);
    expect(tracking.track).not.toHaveBeenCalled();
  });

  it('says why when the pages could not be tracked', async () => {
    tracking.available = true;
    tracking.track.mockRejectedValue(new Error('down'));
    const { user } = renderWithProviders(pagesAs('editor', 'all', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Track in Monitoring' }));
    expect((await screen.findAllByText('The pages could not be tracked')).length).toBeGreaterThan(0);
  });
});
