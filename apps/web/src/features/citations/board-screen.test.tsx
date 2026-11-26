import { screen, waitFor, within } from '@testing-library/react';
import { delay, http } from 'msw';
import type { OnUrlUpdateFunction } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CitationsScreen, type CitationsScreenProps } from './board-screen';
import { Inspector } from '@/components/app/inspector/inspector';
import type { Role } from '@/lib/api/types';
import { downloadBlob } from '@/lib/csv/csv-write';
import { InspectorWidthUserContext, writeInspectorWidth } from '@/lib/inspector/width-store';
import { PermissionProvider } from '@/lib/permissions';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

/** The address the page is on, which the tabs carry over (the nuqs adapter holds the same one for the state). */
const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
// jsdom has no canvas and cannot save a file: the sparklines draw on a stub and a download is only recorded
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csv/csv-write')>()),
  downloadBlob: vi.fn(),
}));

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const ENTITIES = mswPath(`/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}/entities`);
const PROMPT_DRAWER = <aside aria-label="Prompt inspector stub" />;
/** The prompt inspector as the route composes it: the shared drawer, so it has the shared width. */
const REAL_PROMPT_DRAWER = (
  <Inspector
    type="prompt"
    header={{ title: 'Prompt drawer', typeLabel: 'Prompt', typeNoun: 'prompt' }}
    backLabel="Back to Citations"
    onClose={() => undefined}
  >
    <div />
  </Inspector>
);
const USER = 'citations-board-user';
const PROPS: CitationsScreenProps = {
  workspaceId: MOCK_WORKSPACE.workspace_id,
  workspaceSlug: 'digibranders',
  project: { id: fynix.project_id, slug: 'fynix', name: 'Fynix', timeZone: fynix.timezone, ownDomain: fynix.host },
  tab: 'pages',
  promptDrawer: PROMPT_DRAWER,
};

function render(role: Role = 'editor', options: ProvidedRenderOptions = {}, props: Partial<CitationsScreenProps> = {}) {
  nav.search = options.searchParams ?? '';
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory(role)}>
      <InspectorWidthUserContext value={USER}>
        <CitationsScreen {...PROPS} {...props} />
      </InspectorWidthUserContext>
    </PermissionProvider>,
    options,
  );
}

beforeEach(() => {
  stubWideScreen();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  writeInspectorWidth(USER, null);
  restoreWideScreen();
  vi.restoreAllMocks();
  vi.mocked(downloadBlob).mockClear();
});

const lastQuery = (onUrlUpdate: ReturnType<typeof vi.fn<OnUrlUpdateFunction>>): string | undefined =>
  onUrlUpdate.mock.calls.at(-1)?.[0].queryString;

describe('the Citations screen', () => {
  it('shows the strip of the enabled engines, the Cited pages tab and the gap count badge', async () => {
    const { container } = render();
    const expected = CITATIONS_FIXTURE.expected.enabled;
    expect(
      await screen.findByLabelText(new RegExp(`^Total citations: ${String(expected.strip.citations)}\\. `)),
    ).toBeVisible();
    const tabs = screen.getByRole('navigation', { name: 'Citations views' });
    expect(within(tabs).getByRole('link', { name: 'Cited pages' })).toHaveAttribute('aria-current', 'page');
    expect(
      await within(tabs).findByRole('link', {
        name: new RegExp(`^Gap analysis, ${String(expected.gaps.gaps)} gaps?$`),
      }),
    ).toBeVisible();
    expect(await screen.findByRole('table', { name: 'Cited pages' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Citations' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reads ChatGPT from the address', async () => {
    render('editor', { searchParams: 'platform=chatgpt_web' });
    const strip = CITATIONS_FIXTURE.expected.chatgpt.strip;
    expect(await screen.findByLabelText(new RegExp(`^Total citations: ${String(strip.citations)}\\. `))).toBeVisible();
  });

  it('shows no gap count with no competitor chosen', async () => {
    render('editor', { searchParams: 'comp=' });
    const tabs = screen.getByRole('navigation', { name: 'Citations views' });
    expect(await screen.findByRole('table', { name: 'Cited pages' })).toBeVisible();
    expect(within(tabs).getByRole('link', { name: 'Gap analysis' })).toBeVisible();
  });

  it('carries the scope and the search to the other tab, and the drawer to none', async () => {
    render('editor', { searchParams: 'platform=chatgpt_web&q=crm&inspect=cited-page%3A1&itab=page-overview' });
    const tabs = screen.getByRole('navigation', { name: 'Citations views' });
    expect(within(tabs).getByRole('link', { name: /^Gap analysis/ })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/citations/gaps?platform=chatgpt_web&q=crm',
    );
    expect(within(tabs).getByRole('link', { name: 'Cited pages' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/citations?platform=chatgpt_web&q=crm',
    );
  });

  it('moves an old link onto the new keys', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render('editor', { searchParams: 'tab=domains&role=third_party&win=7d', onUrlUpdate });
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(lastQuery(onUrlUpdate)).toBe('?owner=third');
  });

  it('keeps the spaces typed in the search and writes the trimmed text to the address once typing pauses', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const { user } = render('editor', { onUrlUpdate });
    const search = await screen.findByRole('searchbox', { name: 'Search in table' });
    await user.type(search, 'crm ');
    expect(search).toHaveValue('crm ');
    await waitFor(() => expect(lastQuery(onUrlUpdate)).toBe('?q=crm'));
    // The address gave "crm" back: the next word can be typed
    expect(search).toHaveValue('crm ');
    await user.type(search, 'tools');
    expect(search).toHaveValue('crm tools');
    await waitFor(() => expect(lastQuery(onUrlUpdate)).toBe('?q=crm+tools'));
  });

  it('resets the scope and leaves the owner and the search', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const { user } = render('editor', { searchParams: 'platform=chatgpt_web&owner=all&q=crm', onUrlUpdate });
    await user.click(await screen.findByRole('button', { name: 'Reset scope' }));
    await waitFor(() => expect(lastQuery(onUrlUpdate)).toBe('?owner=all&q=crm'));
    expect(screen.queryByRole('button', { name: 'Reset scope' })).toBeNull();
  });

  it('opens a cited page in the drawer, and steps to the next page on J', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const { user } = render('editor', { onUrlUpdate });
    const table = await screen.findByRole('table', { name: 'Cited pages' });
    const first = within(table).getAllByRole('button', { name: /^Open / })[0];
    if (first === undefined) throw new Error('No row');
    await user.click(first);
    expect(await screen.findByRole('complementary')).toHaveTextContent('Cited page');
    const opened = lastQuery(onUrlUpdate);
    expect(opened).toMatch(/^\?inspect=cited-page:\d+$/);
    await user.keyboard('j');
    await waitFor(() => expect(lastQuery(onUrlUpdate)).not.toBe(opened));
    expect(lastQuery(onUrlUpdate)).toMatch(/^\?inspect=cited-page:\d+$/);
  });

  it('lays the page drawer over the board, marks its row, and closes on Escape from inside it', async () => {
    const { user } = render();
    const table = await screen.findByRole('table', { name: 'Cited pages' });
    const first = within(table).getAllByRole('button', { name: /^Open / })[0];
    if (first === undefined) throw new Error('No row');
    await user.click(first);
    const drawer = await screen.findByRole('complementary');
    expect(drawer).toHaveClass('fixed');
    expect(first.closest('tr')).toHaveAttribute('data-active');
    await waitFor(() => expect(drawer).toContainElement(document.activeElement as HTMLElement));
    // A tooltip still showing takes an Escape of its own: the pointer leaves the row first
    await user.unhover(first);
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip"]:not([data-ending-style])')).toBeNull());
    // A drawer a row opened closes by going back, which the test address cannot do: the close is the call
    // (`use-focus-return.test.tsx` covers the focus going back to the row once the drawer is gone)
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    await user.keyboard('{Escape}');
    expect(back).toHaveBeenCalledOnce();
  });

  it('ArrowDown inside the page drawer steps to the next cited page', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const { user } = render('editor', { onUrlUpdate });
    const table = await screen.findByRole('table', { name: 'Cited pages' });
    const [first, second] = within(table).getAllByRole('button', { name: /^Open / });
    if (first === undefined || second === undefined) throw new Error('No rows');
    await user.click(first);
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText(/^1 of \d+$/)).toBeVisible();
    await waitFor(() => expect(drawer).toContainElement(document.activeElement as HTMLElement));
    const opened = lastQuery(onUrlUpdate);
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(lastQuery(onUrlUpdate)).not.toBe(opened));
    expect(lastQuery(onUrlUpdate)).toMatch(/^\?inspect=cited-page:\d+$/);
    expect(await within(screen.getByRole('complementary')).findByText(/^2 of \d+$/)).toBeVisible();
    expect(second.closest('tr')).toHaveAttribute('data-active');
    expect(first.closest('tr')).not.toHaveAttribute('data-active');
  });

  it('J from a row of the board does nothing: the board is a plain table, stepping starts in the drawer', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const { user } = render('editor', { onUrlUpdate });
    const table = await screen.findByRole('table', { name: 'Cited pages' });
    const first = within(table).getAllByRole('button', { name: /^Open / })[0];
    if (first === undefined) throw new Error('No row');
    await user.click(first);
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText(/^1 of \d+$/)).toBeVisible();
    const opened = lastQuery(onUrlUpdate);
    first.focus();
    await user.keyboard('j');
    expect(lastQuery(onUrlUpdate)).toBe(opened);
    expect(within(drawer).getByText(/^1 of \d+$/)).toBeVisible();
    // The same key from inside the drawer steps
    within(drawer).getByRole('heading', { level: 2 }).focus();
    await user.keyboard('j');
    await waitFor(() => expect(lastQuery(onUrlUpdate)).not.toBe(opened));
    // One step in all: a step the row's key had started would have made this the third page
    expect(await within(screen.getByRole('complementary')).findByText(/^2 of \d+$/)).toBeVisible();
  });

  it('keeps one width when a cited page gives way to a prompt and to a gap prompt', async () => {
    writeInspectorWidth(USER, 720);
    const pages = render('editor', {}, { promptDrawer: REAL_PROMPT_DRAWER });
    const cited = await screen.findByRole('table', { name: 'Cited pages' });
    const page = within(cited).getAllByRole('button', { name: /^Open / })[0];
    if (page === undefined) throw new Error('No row');
    await pages.user.click(page);
    const pageDrawer = await screen.findByRole('complementary');
    expect(pageDrawer.style.width).toBe('720px');
    const prompts = await within(pageDrawer).findByRole('table', { name: 'Prompts that cite this page' });
    const prompt = within(prompts).getAllByRole('button')[0];
    if (prompt === undefined) throw new Error('The page has no prompt');
    await pages.user.click(prompt);
    expect((await screen.findByRole('complementary', { name: 'Prompt drawer' })).style.width).toBe('720px');
    pages.unmount();

    const gaps = render('editor', {}, { tab: 'gaps', promptDrawer: REAL_PROMPT_DRAWER });
    const gapTable = await screen.findByRole('table', { name: 'Gap analysis' });
    const gap = within(gapTable).getAllByRole('button', { name: /^Open / })[0];
    if (gap === undefined) throw new Error('No row');
    await gaps.user.click(gap);
    const gapDrawer = await screen.findByRole('complementary');
    expect(gapDrawer.style.width).toBe('720px');
    await gaps.user.click(await within(gapDrawer).findByRole('button', { name: 'Open answers' }));
    expect((await screen.findByRole('complementary', { name: 'Prompt drawer' })).style.width).toBe('720px');
  });

  it('reopens a shared cited page link in the drawer', async () => {
    render('editor', { searchParams: 'inspect=cited-page%3A1' });
    expect(await screen.findByRole('complementary')).toHaveTextContent('Cited page');
  });

  it('draws the gap analysis on its route', async () => {
    render('editor', {}, { tab: 'gaps' });
    expect(await screen.findByRole('table', { name: 'Gap analysis' })).toBeVisible();
    const tabs = screen.getByRole('navigation', { name: 'Citations views' });
    expect(within(tabs).getByRole('link', { name: /^Gap analysis/ })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the gap drawer, and from it the answers of the prompt in the prompt inspector', async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    const { user } = render('editor', { onUrlUpdate }, { tab: 'gaps' });
    const table = await screen.findByRole('table', { name: 'Gap analysis' });
    const first = within(table).getAllByRole('button', { name: /^Open / })[0];
    if (first === undefined) throw new Error('No row');
    await user.click(first);
    const drawer = await screen.findByRole('complementary', { name: /./ });
    expect(await within(drawer).findByRole('heading', { name: 'Who is cited' })).toBeVisible();
    expect(lastQuery(onUrlUpdate)).toMatch(/^\?inspect=gap-prompt:/);
    await user.click(await within(drawer).findByRole('button', { name: 'Open answers' }));
    await waitFor(() => expect(lastQuery(onUrlUpdate)).toMatch(/^\?inspect=prompt:/));
    expect(await screen.findByRole('complementary', { name: 'Prompt inspector stub' })).toBeVisible();
  });

  it('asks for competitors when none is chosen, and opens the competitors popover from the empty state', async () => {
    const { user } = render('editor', { searchParams: 'comp=' }, { tab: 'gaps' });
    expect(await screen.findByRole('heading', { name: 'Choose competitors to compare' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Choose competitors' }));
    expect(await screen.findByRole('dialog', { name: 'Competitors to compare' })).toBeVisible();
  });

  it('shows no empty state on the gap analysis while the tracked competitors load, then the table', async () => {
    // The handler answers nothing after the wait, so the default one answers
    server.use(
      http.get(ENTITIES, async () => {
        await delay(150);
      }),
    );
    render('editor', {}, { tab: 'gaps' });
    expect(screen.queryByRole('heading', { name: 'Choose competitors to compare' })).toBeNull();
    expect(await screen.findByRole('table', { name: 'Gap analysis' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Choose competitors to compare' })).toBeNull();
  });

  it('shows the error with Try again, not the empty state, when the tracked competitors fail to load', async () => {
    server.use(http.get(ENTITIES, ({ request }) => problem(request, 'internal_error')));
    render('editor', {}, { tab: 'gaps' });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Choose competitors to compare' })).toBeNull();
  });

  it('exports every cited page the API has for the owner and the search', async () => {
    const { user } = render();
    await screen.findByRole('table', { name: 'Cited pages' });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('cited-pages.csv');
    expect((await screen.findAllByText(/^Exported \d+ rows?$/)).length).toBeGreaterThan(0);
  });

  it('exports the prompts of the gap analysis as shown', async () => {
    const { user } = render('editor', {}, { tab: 'gaps' });
    await screen.findByRole('table', { name: 'Gap analysis' });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('gap-analysis.csv');
  });

  it('says a role without data:read cannot open it', () => {
    render('billing');
    expect(screen.getByRole('heading', { name: 'You cannot open citations' })).toBeVisible();
  });
});
