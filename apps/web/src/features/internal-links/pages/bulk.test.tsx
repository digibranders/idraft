import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockBrowser } from '@/test/mock-api';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { crawledPages, EVENTUS, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PAGES = mswPath(`${P}/internal-links/pages`);
const TIERS = mswPath(`${P}/pages/tiers`);
const RESET = mswPath(`${P}/pages/tiers/reset`);
const TAGS = mswPath(`${P}/pages/tags`);

beforeEach(stubWideScreen);
afterEach(() => {
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await rowOf('/about');
    await user.keyboard('2');
    await user.click(await checkbox('/about'));
    // The fixture workspace has four tiers
    await user.keyboard('7');
    expect(bodies).toEqual([]);
  });

  it('does not take the keys while a dialog is open', async () => {
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
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
    const { user } = renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await rowOf('/about');
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.keyboard('2');
    expect(bodies).toEqual([]);
  });

  it('sends the filter when every matching page is chosen, and names the count the API answers', async () => {
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
    const bodies = bodiesOf(TIERS, 'put');
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'status=2xx' });
    await grid();
    await user.click(await screen.findByRole('checkbox', { name: /^Select all \d+ pages loaded/ }));
    await user.click(await screen.findByRole('button', { name: /Select all 250 matching/ }));
    await user.keyboard('1');
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ filter: { status: ['2xx'] }, tier_id: expect.any(String) });
    expect(bodies[0]).not.toHaveProperty('url_ids');
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.keyboard('1');
    expect((await screen.findAllByText('The change could not be saved')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/is now/)).toBeNull();
  });

  it('opens the journey of one chosen page only, and shows no equity anywhere', async () => {
    const { user, container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'q=%2Fabout',
    });
    await user.click(await checkbox('/about'));
    expect(await screen.findByRole('button', { name: 'Open in journey' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/equity/i);
    expect(document.body.textContent).not.toMatch(/equity/i);
  });
});

describe('bulk tags (spec 5.3)', () => {
  it('says so, with a way to the taxonomy, when the project has no tags', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(await checkbox('/about'));
    await user.click(await screen.findByRole('button', { name: 'Add tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a tag to 1 page' });
    expect(within(dialog).getByText(/no tag vocabulary yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open Taxonomy' })).toHaveAttribute(
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
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
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
