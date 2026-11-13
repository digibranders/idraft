import { act, screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CitationsScreen, type CitationsProject } from './citations-screen';
import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import { apiQuery, type ApiResponse } from '@/lib/api/query';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

// A test turns the Pages entry off to see the page before T5a lists it
const registry = vi.hoisted(() => ({ withPages: true, real: false }));

// The two tabs the page lists once T4b and T5a land, as text, so the shell is tested on its own
vi.mock('./citation-tabs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./citation-tabs')>();
  const entry = (id: 'domains' | 'pages', label: string): ReturnType<typeof actual.defineCitationTabs>[number] => ({
    id,
    label: () => label,
    render: () => `Panel of ${label}`,
  });
  const both = actual.defineCitationTabs([entry('domains', 'Domains'), entry('pages', 'Pages')]);
  const domainsOnly = actual.defineCitationTabs([entry('domains', 'Domains')]);
  return {
    ...actual,
    get CITATION_TABS() {
      // A test that follows a read through the real tabs turns the text panels off
      if (registry.real) return actual.CITATION_TABS;
      return registry.withPages ? both : domainsOnly;
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
  // The real Domains tab reads the address to build its "View all" links
  useSearchParams: () => new URLSearchParams(),
}));

// jsdom has no canvas: the domain inspector's trend chart is drawn as a stand-in
vi.mock('@/components/app/chart/echart', () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = `${P}/engines`;
const DOMAINS = mswPath(`${P}/ai/sources/domains`);
const DIVERSITY = mswPath(`${P}/ai/sources/diversity`);

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const asProject = (project: (typeof MOCK_PROJECTS)[number]): CitationsProject => ({
  id: project.project_id,
  slug: project.slug,
  name: project.name,
  timeZone: project.timezone,
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  registry.withPages = true;
  registry.real = false;
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
});

const fynixProject = asProject(fynix);

function citationsAs(role: Role, project: CitationsProject = fynixProject): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <TopBarSlotProvider>
      <TopBarSlotTarget />
      <PermissionProvider membership={membershipFactory(role)}>
        <Suspense fallback={null}>
          <CitationsScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={project}
          />
        </Suspense>
      </PermissionProvider>
    </TopBarSlotProvider>
  );
}

const render = (searchParams = '', options: ProvidedRenderOptions = {}): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(citationsAs('viewer'), { searchParams, ...options });

/** Every request the mock server saw, as URLs. */
function watch(): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => seen.push(new URL(request.url)));
  return seen;
}
const to = (seen: readonly URL[], route: string): URL[] => seen.filter((url) => url.pathname.endsWith(route));

const strip = (): Promise<HTMLElement> => screen.findByRole('group', { name: 'Citation summary' });
const cell = (name: string): HTMLElement => {
  const found = screen.getByText(name).closest('div');
  if (found === null) throw new Error(`The ${name} cell is missing`);
  return found;
};

/** A promise a test settles itself, to hold an answer back. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('Citations page', () => {
  it('renders one h1, the tab list, the strip and the filter bar', async () => {
    const { container } = render();
    expect(await screen.findByRole('heading', { level: 1, name: 'Citations' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const tabs = screen.getByRole('tablist', { name: 'Citation views' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(2);
    expect(within(tabs).getByRole('tab', { name: 'Domains' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'Pages' })).toBeInTheDocument();
    expect(await strip()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a filter' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('vs previous period');
    expect(await screen.findByText('Panel of Domains')).toBeInTheDocument();
    await waitFor(() => expect(strip()).resolves.not.toHaveAttribute('aria-busy'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says the meta line with units and answers', async () => {
    render();
    expect(await screen.findByText(/^Updated .* ago; [\d,]+ citation units in [\d,]+ answers$/)).toBeInTheDocument();
  });

  /** The newest citation of the scope was read at `observedAt`. */
  const newestAt = (observedAt: string): void =>
    server.use(
      http.get(mswPath(`${P}/ai/citations`), async ({ request }) => {
        const real = await getResponse([...handlers], request);
        const body = (await real?.json()) as { data: { observed_at: string }[] };
        return HttpResponse.json({
          ...body,
          data: body.data.map((row) => ({ ...row, observed_at: observedAt })),
        });
      }),
    );

  it('says No new citation since a date when the newest citation is older than 7 days', async () => {
    newestAt('2026-11-02T02:00:00Z');
    render();
    expect(await screen.findByText(/^No new citation since Nov 2, /)).toBeInTheDocument();
  });

  it('calls a citation stale from 7 days on, as the prompt History does, and not before', async () => {
    // Today is 12 November in the project's zone: the 5th is 7 days back, the 6th is 6
    newestAt('2026-11-05T02:00:00Z');
    const stale = render();
    expect(await screen.findByText(/^No new citation since Nov 5, /)).toBeInTheDocument();
    stale.unmount();
    newestAt('2026-11-06T02:00:00Z');
    render();
    expect(await screen.findByText(/^Updated 6d ago; /)).toBeInTheDocument();
  });

  it('gives the page the height of the window from lg up, so a table fills what the strip leaves', async () => {
    render();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Citations' });
    expect(heading.closest('.lg\\:h-page-body')).toHaveClass('lg:min-h-page-body-min', 'flex', 'flex-col');
    const tabs = document.querySelector('[data-slot="tabs"]');
    expect(tabs).toHaveClass('lg:min-h-0', 'lg:flex-1');
    expect(await screen.findByText('Panel of Domains')).toHaveClass('lg:min-h-0', 'lg:flex-1');
  });

  it('lets the whole page scroll below lg, strip and filters with the table, so a short phone is not left a sliver', async () => {
    render();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Citations' });
    const body = heading.closest('.lg\\:h-page-body');
    // No height below lg: the height classes all carry the lg prefix
    expect(body?.className.split(' ').filter((name) => /^(min-)?h-page-body/.test(name))).toEqual([]);
    const tabs = document.querySelector('[data-slot="tabs"]');
    expect(tabs?.className.split(' ')).not.toContain('flex-1');
  });

  it('keeps the page that scrolls with the window for the no access state', async () => {
    renderWithProviders(citationsAs('billing'));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Citations' });
    expect(heading.closest('.lg\\:h-page-body')).toBeNull();
  });

  it('says no citation in the window when there is no unit', async () => {
    server.use(
      http.get(DOMAINS, async ({ request }) => {
        const real = await getResponse([...handlers], request);
        const body = (await real?.json()) as { meta: object };
        return HttpResponse.json({
          ...body,
          meta: { ...body.meta, citation_units: 0, by_role: [], answers_citing: 0 },
        });
      }),
    );
    render();
    expect(await screen.findByText('No citation in this window')).toBeInTheDocument();
  });

  it('a viewer without data:read sees the no access state', async () => {
    const reads = watch();
    renderWithProviders(citationsAs('billing'));
    expect(await screen.findByRole('heading', { name: 'You cannot open citations' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(to(reads, '/ai/sources/domains')).toHaveLength(0);
  });

  it('without an enabled engine says so and links to Engines', async () => {
    const reads = watch();
    renderWithProviders(citationsAs('editor', asProject(cleanstart)));
    expect(await screen.findByRole('heading', { name: 'No engine is on' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Engines' })).toHaveAttribute(
      'href',
      '/digibranders/cleanstart/settings/engines',
    );
    expect(to(reads, '/ai/sources/domains')).toHaveLength(0);
  });

  it('a failed scope read shows an inline error with Retry and keeps the header', async () => {
    let calls = 0;
    server.use(
      http.get(DOMAINS, async ({ request }) => {
        calls += 1;
        if (calls === 1) return problem(request, 'not_found');
        return (await getResponse([...handlers], request)) ?? problem(request, 'not_found');
      }),
    );
    const { user } = render();
    expect(await screen.findByText('Citations could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Citations' })).toBeInTheDocument();
    expect(screen.queryByText('Panel of Domains')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Panel of Domains')).toBeInTheDocument();
    expect(screen.queryByText('Citations could not be loaded')).toBeNull();
  });

  it('a failed diversity read leaves the other strip items and shows the partial banner, and Retry reads it again', async () => {
    let calls = 0;
    server.use(
      http.get(DIVERSITY, async ({ request }) => {
        calls += 1;
        if (calls === 1) return problem(request, 'not_found');
        return (await getResponse([...handlers], request)) ?? problem(request, 'not_found');
      }),
    );
    const { user } = render();
    expect(await screen.findByText('Some figures could not be loaded.')).toBeInTheDocument();
    await waitFor(() => expect(cell('Citation units')).toHaveTextContent(/[\d,]{3,}/));
    expect(cell('Distinct domains')).toHaveTextContent('n/a');
    await user.click(
      within(screen.getByText('Some figures could not be loaded.').closest('div') as HTMLElement).getByRole('button', {
        name: 'Try again',
      }),
    );
    await waitFor(() => expect(screen.queryByText('Some figures could not be loaded.')).toBeNull());
    expect(calls).toBe(2);
    expect(cell('Distinct domains')).not.toHaveTextContent('n/a');
  });

  /** The banner's Retry button. */
  const bannerRetry = (): HTMLElement =>
    within(screen.getByText('Some figures could not be loaded.').closest('div') as HTMLElement).getByRole('button', {
      name: 'Try again',
    });

  /**
   * Fails the requests of `route` that `fails` accepts for as long as `broken.on` is true, and lists them, so a test
   * can tell which reads a Retry asked for again.
   */
  function breakReads(route: RegExp, fails: (url: URL) => boolean): { broken: { on: boolean }; requests: URL[] } {
    const broken = { on: true };
    const requests: URL[] = [];
    server.use(
      http.get(route, async ({ request }) => {
        const url = new URL(request.url);
        if (fails(url)) requests.push(url);
        if (broken.on && fails(url)) return problem(request, 'not_found');
        return (await getResponse([...handlers], request)) ?? problem(request, 'not_found');
      }),
    );
    return { broken, requests };
  }

  it('says Retry asks again for every read that failed, not for the first only', async () => {
    const diversity = breakReads(/\/ai\/sources\/diversity$/, () => true);
    const added = breakReads(/\/ai\/sources\/changes$/, (url) => url.searchParams.get('kind') === 'new');
    const { user } = render();
    expect(await screen.findByText('Some figures could not be loaded.')).toBeInTheDocument();
    expect(diversity.requests).toHaveLength(1);
    expect(added.requests).toHaveLength(1);
    diversity.broken.on = false;
    added.broken.on = false;
    await user.click(bannerRetry());
    await waitFor(() => expect(screen.queryByText('Some figures could not be loaded.')).toBeNull());
    expect(diversity.requests).toHaveLength(2);
    expect(added.requests).toHaveLength(2);
    expect(cell('Distinct domains')).not.toHaveTextContent('n/a');
    expect(cell('New sources')).not.toHaveTextContent('n/a');
  });

  it.each([
    ['New', 'new', 'Lost sources'],
    ['Lost', 'lost', 'New sources'],
  ])('a failed %s read shows the partial banner, is n/a and leaves the other count', async (_name, kind, other) => {
    const failing = breakReads(/\/ai\/sources\/changes$/, (url) => url.searchParams.get('kind') === kind);
    const { user } = render();
    expect(await screen.findByText('Some figures could not be loaded.')).toBeInTheDocument();
    await waitFor(() => expect(cell(other)).toHaveTextContent(/\d/));
    expect(cell(kind === 'new' ? 'New sources' : 'Lost sources')).toHaveTextContent('n/a');
    failing.broken.on = false;
    await user.click(bannerRetry());
    await waitFor(() => expect(screen.queryByText('Some figures could not be loaded.')).toBeNull());
    expect(failing.requests).toHaveLength(2);
  });

  it('a refetch that failed keeps the figures and still counts as failed', async () => {
    const failing = breakReads(/\/ai\/sources\/diversity$/, () => true);
    failing.broken.on = false;
    const { user, queryClient } = render();
    await waitFor(() => expect(cell('Distinct domains')).toHaveTextContent(/\d/));
    const before = cell('Distinct domains').textContent;
    expect(screen.queryByText('Some figures could not be loaded.')).toBeNull();
    failing.broken.on = true;
    await act(() =>
      queryClient.refetchQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes('diversity') }),
    );
    // The read has its data and an error: its status is ready, so only the error id says it failed
    expect(await screen.findByText('Some figures could not be loaded.')).toBeInTheDocument();
    expect(cell('Distinct domains').textContent).toBe(before);
    failing.broken.on = false;
    await user.click(bannerRetry());
    await waitFor(() => expect(screen.queryByText('Some figures could not be loaded.')).toBeNull());
  });

  it('the strip counts a new and a lost source', async () => {
    render();
    for (const name of ['New sources', 'Lost sources']) {
      await waitFor(() => expect(cell(name)).toHaveTextContent(/^\D+1\D/));
      expect(cell(name)).not.toHaveTextContent('n/a');
      expect(cell(name)).not.toHaveTextContent('The previous period has no answers');
    }
  });

  it('counts the read of the previous period while the comparison is on and stops when it is turned off', async () => {
    // The previous period is the one read of the domains that takes no `compare` and no `include`
    const previous = breakReads(
      /\/ai\/sources\/domains$/,
      (url) => !url.searchParams.has('compare') && !url.searchParams.has('include'),
    );
    const { user } = render();
    expect(await screen.findByText('Some figures could not be loaded.')).toBeInTheDocument();
    expect(previous.requests.length).toBeGreaterThan(0);
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    await waitFor(() => expect(screen.queryByText('Some figures could not be loaded.')).toBeNull());
    expect(cell('Citation units')).toHaveTextContent(/[\d,]{3,}/);
  });

  it('choosing a Role keeps the Own citation share, and no strip read takes the role filter', async () => {
    const reads = watch();
    render('?role=competitor');
    await waitFor(() => expect(cell('Own citation share')).toHaveTextContent(/\d+(\.\d)?%/));
    expect(cell('Own citation share')).toHaveTextContent(/of [\d,]+ units/);
    const strips = [
      ...to(reads, '/ai/sources/domains'),
      ...to(reads, '/ai/sources/diversity'),
      ...to(reads, '/ai/sources/changes'),
      ...to(reads, '/ai/citations'),
    ];
    expect(strips.length).toBeGreaterThanOrEqual(6);
    for (const url of strips) expect(url.searchParams.has('filter[domain_role_in]')).toBe(false);
  });

  it('passes the minimum to the New and Lost reads as min_support', async () => {
    const reads = watch();
    render('?min=5');
    await waitFor(() => expect(to(reads, '/ai/sources/changes')).toHaveLength(2));
    const changes = to(reads, '/ai/sources/changes');
    expect(changes.map((url) => url.searchParams.get('kind')).sort()).toEqual(['lost', 'new']);
    for (const url of changes) expect(url.searchParams.get('min_support')).toBe('5');
  });

  it('the date range is the top bar picker and not a filter chip', async () => {
    render('?win=7d');
    expect(await screen.findByRole('button', { name: /^Date range: Last 7 days/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('Copy link copies the address and says so', async () => {
    const { user } = render();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(window.location.href));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('has Export CSV in the header, disabled with its reason until the tab has rows', async () => {
    render();
    const button = await screen.findByRole('button', { name: 'Export CSV' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('The rows are not loaded');
  });

  it('turns Export CSV on when the tab that is shown has loaded its rows', async () => {
    registry.real = true;
    render('?tab=pages');
    const button = await screen.findByRole('button', { name: 'Export CSV' });
    await screen.findByRole('grid', { name: 'Cited pages' });
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled', 'true'));
  });

  it('a saved view preset writes its keys and Reset restores them', async () => {
    const writes: string[] = [];
    const { user } = render('', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    await user.click(await screen.findByRole('button', { name: /^Saved view: Default/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Competitor sources' }));
    await waitFor(() => expect(writes.at(-1)).toContain('role=competitor'));
    expect(writes.at(-1)).toContain('view=competitor-sources');
    // An edit away from the view, then Reset to it
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    await waitFor(() => expect(writes.at(-1)).toContain('cmp=off'));
    await user.click(await screen.findByRole('button', { name: /^Saved view: Competitor sources, edited/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reset to Competitor sources' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('cmp=off'));
    expect(writes.at(-1)).toContain('role=competitor');
  });
});

describe('Citations page: the scope in the address', () => {
  it('writes nothing to the address on load', async () => {
    const writes: string[] = [];
    render('?engine=gemini_web&role=own&min=3', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    await strip();
    await waitFor(() => expect(cell('Citation units')).toHaveTextContent(/[\d,]{3,}/));
    expect(writes).toEqual([]);
  });

  it('writes a key with history replace, and null removes it', async () => {
    const writes: { queryString: string; history: string | undefined }[] = [];
    const { user } = render('', {
      onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
    });
    await user.click(await screen.findByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=off'));
    expect(writes.at(-1)?.history).toBe('replace');
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'vs previous period' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).not.toContain('cmp'));
  });

  it('opens on the tab of the link, and a tab that is not listed falls back to Domains', async () => {
    const pages = render('?tab=pages');
    expect(await screen.findByText('Panel of Pages')).toBeInTheDocument();
    pages.unmount();
    render('?tab=changes');
    expect(await screen.findByText('Panel of Domains')).toBeInTheDocument();
  });

  it('the tab list writes the tab as a history entry, and Domains writes nothing', async () => {
    const writes: { queryString: string; history: string | undefined }[] = [];
    const { user } = render('', {
      onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
    });
    await user.click(await screen.findByRole('tab', { name: 'Pages' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('tab=pages'));
    // A view is a place to go back to
    expect(writes.at(-1)?.history).toBe('push');
    await user.click(screen.getByRole('tab', { name: 'Domains' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).not.toContain('tab'));
    expect(writes.at(-1)?.history).toBe('push');
  });

  it('a tab change drops the saved columns, which belong to the table that was left', async () => {
    registry.real = true;
    const writes: string[] = [];
    const { user } = render('?cols=domain,answers', {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await user.click(await screen.findByRole('tab', { name: 'New and lost' }));
    await waitFor(() => expect(writes.at(-1)).toContain('tab=new-lost'));
    expect(writes.at(-1)).not.toContain('cols');
  });

  it('writes a filter or the comparison with history replace, not as an entry', async () => {
    const writes: { queryString: string; history: string | undefined }[] = [];
    const { user } = render('?tab=pages', {
      onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
    });
    await user.click(await screen.findByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=off'));
    expect(writes.at(-1)?.history).toBe('replace');
    expect(writes.at(-1)?.queryString).toContain('tab=pages');
  });

  it('offers the Domain filter on the Pages tab only when that tab is listed', async () => {
    const listed = render('?tab=pages');
    await screen.findByText('Panel of Pages');
    await listed.user.click(screen.getByRole('button', { name: 'Add a filter' }));
    expect(await screen.findByRole('button', { name: 'Domain' })).toBeInTheDocument();
    listed.unmount();
    // Before T5a lists Pages the page shows Domains, so its filters are those of Domains
    registry.withPages = false;
    const unlisted = render('?tab=pages');
    expect(await screen.findByText('Panel of Domains')).toBeInTheDocument();
    await unlisted.user.click(screen.getByRole('button', { name: 'Add a filter' }));
    expect(await screen.findByRole('button', { name: 'Engine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Domain' })).toBeNull();
  });

  it('removing the Domain chip drops the key and the next pages read has no domain filter', async () => {
    registry.real = true;
    const reads = watch();
    const writes: string[] = [];
    const { user } = render('?tab=pages&domain=equals:g2.com', {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await screen.findByRole('grid', { name: 'Cited pages' });
    await waitFor(() => expect(to(reads, '/ai/sources/pages').length).toBeGreaterThan(0));
    expect(
      to(reads, '/ai/sources/pages').every((url) => url.searchParams.get('filter[registrable_domain]') === 'g2.com'),
    ).toBe(true);
    const before = to(reads, '/ai/sources/pages').length;
    await user.click(await screen.findByRole('button', { name: 'Remove filter Domain equals: g2.com' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('domain'));
    expect(writes.at(-1)).toContain('tab=pages');
    await waitFor(() => expect(to(reads, '/ai/sources/pages').length).toBeGreaterThan(before));
    expect(to(reads, '/ai/sources/pages').at(-1)?.searchParams.has('filter[registrable_domain]')).toBe(false);
  });

  it('reads nothing before the engines resolve, keeps the engine in the address and then asks for it', async () => {
    const held = gate();
    server.use(
      http.get(mswPath(ENGINES), async ({ request }) => {
        await held.opened;
        return (await getResponse([...handlers], request)) ?? problem(request, 'not_found');
      }),
    );
    const reads = watch();
    const writes: string[] = [];
    render('?engine=gemini_web', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    // The strip is on its skeletons while the engines are on their way
    expect(await strip()).toHaveAttribute('aria-busy', 'true');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(to(reads, '/ai/sources/domains')).toHaveLength(0);
    expect(to(reads, '/ai/sources/diversity')).toHaveLength(0);
    expect(to(reads, '/ai/sources/changes')).toHaveLength(0);
    expect(to(reads, '/ai/citations')).toHaveLength(0);
    expect(writes).toEqual([]);
    held.open();
    await waitFor(() => expect(to(reads, '/ai/sources/domains').length).toBeGreaterThan(0));
    for (const url of to(reads, '/ai/sources/domains')) {
      expect(url.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    }
    expect(writes).toEqual([]);
  });

  it('shows an inline error with Retry when the engines cannot be read, and reads nothing', async () => {
    let calls = 0;
    server.use(
      http.get(mswPath(ENGINES), async ({ request }) => {
        calls += 1;
        if (calls === 1) return problem(request, 'not_found');
        return (await getResponse([...handlers], request)) ?? problem(request, 'not_found');
      }),
    );
    const reads = watch();
    const writes: string[] = [];
    const { user } = render('?engine=gemini_web', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    expect(await screen.findByText('Citations could not be loaded')).toBeInTheDocument();
    expect(to(reads, '/ai/sources/domains')).toHaveLength(0);
    expect(writes).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Panel of Domains')).toBeInTheDocument();
    await waitFor(() => expect(to(reads, '/ai/sources/domains').length).toBeGreaterThan(0));
  });

  it('leaves out an engine that is off, and follows the engines when they change', async () => {
    const reads = watch();
    const { queryClient } = render('?engine=gemini_web');
    await waitFor(() => expect(to(reads, '/ai/sources/domains').length).toBeGreaterThan(0));
    expect(to(reads, '/ai/sources/domains').at(-1)?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    const key = apiQuery(ENGINES, {
      params: { path: { workspace_id: MOCK_WORKSPACE.workspace_id, project_id: fynix.project_id } },
    }).queryKey;
    const data = queryClient.getQueryData<ApiResponse<'get', typeof ENGINES>>(key);
    if (data === undefined) throw new Error('The engines are not in the cache');
    const before = to(reads, '/ai/sources/domains').length;
    act(() => {
      queryClient.setQueryData(key, {
        ...data,
        data: data.data.map((engine) =>
          engine.engine.engine_code === 'gemini_web' ? { ...engine, is_enabled: false } : engine,
        ),
      });
    });
    await waitFor(() => expect(to(reads, '/ai/sources/domains').length).toBeGreaterThan(before));
    expect(to(reads, '/ai/sources/domains').at(-1)?.searchParams.has('filter[engine_code_in]')).toBe(false);
  });

  it('follows the date range of the picker', async () => {
    const reads = watch();
    const { user } = render();
    await waitFor(() => expect(to(reads, '/ai/sources/domains').length).toBeGreaterThan(0));
    expect(to(reads, '/ai/sources/domains')[0]?.searchParams.get('from')).toBe('2026-10-16');
    await user.click(await screen.findByRole('button', { name: /^Date range: / }));
    await user.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    // The scope read of the new window (the read of the period before has no `compare`)
    const scopeRead = (): URL | undefined =>
      to(reads, '/ai/sources/domains')
        .filter((url) => url.searchParams.has('compare'))
        .at(-1);
    await waitFor(() => expect(scopeRead()?.searchParams.get('from')).toBe('2026-11-06'));
    expect(scopeRead()?.searchParams.get('to')).toBe('2026-11-12');
  });

  it('asks for the newest citation of the whole scope for the meta line', async () => {
    const reads = watch();
    render();
    await waitFor(() => expect(to(reads, '/ai/citations').length).toBeGreaterThan(0));
    expect(to(reads, '/ai/citations')[0]?.searchParams.get('limit')).toBe('1');
  });
});

describe('Citations page: the New and lost tab', () => {
  it('lists three tabs', async () => {
    registry.real = true;
    render();
    const tabs = await screen.findByRole('tablist', { name: 'Citation views' });
    const items = within(tabs).getAllByRole('tab');
    expect(items).toHaveLength(3);
    for (const name of ['Domains', 'Pages', 'New and lost']) {
      expect(within(tabs).getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('opens on New and lost from the link and writes the tab as a history entry', async () => {
    registry.real = true;
    const writes: { queryString: string; history: string | undefined }[] = [];
    const { user } = render('', {
      onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
    });
    await user.click(await screen.findByRole('tab', { name: 'New and lost' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('tab=new-lost'));
    expect(writes.at(-1)?.history).toBe('push');
    expect(await screen.findByRole('grid', { name: 'New sources' })).toBeInTheDocument();
  });

  it('Export is not offered on New and lost', async () => {
    registry.real = true;
    const domains = render();
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    domains.unmount();
    render('?tab=new-lost');
    await screen.findByRole('grid', { name: 'New sources' });
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  });

  it('the flag chips clear with Clear filters', async () => {
    registry.real = true;
    const writes: string[] = [];
    const { user } = render('?tab=new-lost&redirects=include&internal=include', {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(
      await screen.findByRole('button', { name: 'Remove filter Unresolved redirects: Include unresolved redirects' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove filter Engine links: Include engine-internal links' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('redirects'));
    expect(writes.at(-1)).not.toContain('internal');
    expect(writes.at(-1)).toContain('tab=new-lost');
    expect(screen.queryByRole('button', { name: /^Remove filter/ })).toBeNull();
  });

  it('a flag is a view key: it makes the saved view read as edited', async () => {
    registry.real = true;
    render('?redirects=include');
    expect(await screen.findByRole('button', { name: /^Saved view: Default, edited/ })).toBeInTheDocument();
  });

  it('sends a flag to every read except the citations list route', async () => {
    registry.real = true;
    const reads = watch();
    render('?tab=new-lost&redirects=include&internal=include');
    await screen.findByRole('grid', { name: 'New sources' });
    await waitFor(() => expect(to(reads, '/ai/citations').length).toBeGreaterThan(0));
    for (const route of ['/ai/sources/domains', '/ai/sources/diversity', '/ai/sources/changes']) {
      expect(to(reads, route).length).toBeGreaterThan(0);
      for (const url of to(reads, route)) {
        expect(url.searchParams.get('include_unresolved_redirects')).toBe('true');
        expect(url.searchParams.get('include_engine_internal')).toBe('true');
      }
    }
    // The route answers 422 for a flag
    for (const url of to(reads, '/ai/citations')) {
      expect(url.searchParams.has('include_unresolved_redirects')).toBe(false);
      expect(url.searchParams.has('include_engine_internal')).toBe(false);
    }
  });

  it("the strip's counts equal the segment counts", async () => {
    registry.real = true;
    render('?tab=new-lost');
    const table = await screen.findByRole('grid', { name: 'New sources' });
    await waitFor(() => expect(within(table).queryAllByRole('rowheader').length).toBeGreaterThan(0));
    // The table's own caption says "New sources" too, so the strip's cell is looked up inside the strip
    const stripGroup = await strip();
    const stripCount = (name: string): string =>
      within(stripGroup).getByText(name).closest('div')?.textContent?.match(/\d+/)?.[0] ?? '';
    await waitFor(() => expect(stripCount('New sources')).not.toBe(''));
    await waitFor(() => expect(stripCount('Lost sources')).not.toBe(''));
    expect(screen.getByRole('radio', { name: `New ${stripCount('New sources')}` })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: `Lost ${stripCount('Lost sources')}` })).toBeInTheDocument();
  });

  it('asks each of New and Lost once for the strip and the tab together', async () => {
    registry.real = true;
    const reads = watch();
    render('?tab=new-lost');
    await screen.findByRole('grid', { name: 'New sources' });
    await waitFor(() => expect(to(reads, '/ai/sources/changes')).toHaveLength(2));
    expect(
      to(reads, '/ai/sources/changes')
        .map((url) => url.searchParams.get('kind'))
        .sort(),
    ).toEqual(['lost', 'new']);
  });
});

describe('Citations page: the country scope', () => {
  const countryControl = (name = 'Country: All countries'): Promise<HTMLElement> =>
    screen.findByRole('combobox', { name });
  const COUNTRY = 'filter[country_iso]';
  /** The routes every tab reads for the strip, and the one list route each tab reads besides. */
  const STRIP_ROUTES = ['/ai/sources/domains', '/ai/sources/diversity', '/ai/sources/changes', '/ai/citations'];

  it('puts the control in the top bar after the date range', async () => {
    render();
    const country = await countryControl();
    const range = await screen.findByRole('button', { name: /^Date range: / });
    expect(range.compareDocumentPosition(country) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('combobox', { name: /^Country:/ })).toHaveLength(1);
  });

  it('lists all countries and the countries of the prompts', async () => {
    const { user } = render();
    await user.click(await countryControl());
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'All countries',
      'Germany',
      'India',
    ]);
  });

  it('choosing a country asks every read with filter[country_iso] and writes the key, and All countries removes it', async () => {
    const reads = watch();
    const writes: string[] = [];
    const { user } = render('', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    await waitFor(() => expect(to(reads, '/ai/sources/domains').length).toBeGreaterThan(0));
    for (const url of reads) expect(url.searchParams.has(COUNTRY)).toBe(false);
    await user.click(await countryControl());
    await user.click(await screen.findByRole('option', { name: 'Germany' }));
    await waitFor(() => expect(new URLSearchParams(writes.at(-1)).get('country')).toBe('DE'));
    for (const route of STRIP_ROUTES) {
      await waitFor(() => expect(to(reads, route).some((url) => url.searchParams.get(COUNTRY) === 'DE')).toBe(true));
    }
    expect(await countryControl('Country: Germany')).toBeInTheDocument();
    await user.click(await countryControl('Country: Germany'));
    await user.click(await screen.findByRole('option', { name: 'All countries' }));
    await waitFor(() => expect(new URLSearchParams(writes.at(-1)).has('country')).toBe(false));
  });

  it('keeps the old rows while the new country is read', async () => {
    registry.real = true;
    const held = gate();
    server.use(
      http.get(DOMAINS, async ({ request }) => {
        if (new URL(request.url).searchParams.get(COUNTRY) === 'DE') await held.opened;
        return (await getResponse([...handlers], request)) ?? problem(request, 'not_found');
      }),
    );
    const { user } = render();
    const table = await screen.findByRole('treegrid', { name: 'Cited domains' });
    await waitFor(() => expect(within(table).queryAllByRole('rowheader').length).toBeGreaterThan(0));
    const before = within(table).getAllByRole('rowheader').length;
    await user.click(await countryControl());
    await user.click(await screen.findByRole('option', { name: 'Germany' }));
    await waitFor(() => expect(table).toHaveAttribute('aria-busy', 'true'));
    expect(within(table).getAllByRole('rowheader')).toHaveLength(before);
    held.open();
    await waitFor(() => expect(table).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('Clear filters does not clear the country', async () => {
    const writes: string[] = [];
    const { user } = render('?country=DE&redirects=include', {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('redirects'));
    expect(new URLSearchParams(writes.at(-1)).get('country')).toBe('DE');
    expect(await countryControl('Country: Germany')).toBeInTheDocument();
  });

  it('the Clear filters of an empty table does not clear the country either', async () => {
    registry.real = true;
    const writes: string[] = [];
    // 1,000 is the most the minimum takes: no domain of the mock world reaches it
    const { user } = render('?country=DE&min=1000&redirects=include', {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const heading = await screen.findByRole('heading', { name: 'No domain or page matches these filters' });
    const empty = heading.parentElement as HTMLElement;
    await user.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('redirects'));
    expect(writes.at(-1)).not.toContain('min=');
    expect(new URLSearchParams(writes.at(-1)).get('country')).toBe('DE');
  });

  it('the country is no filter chip and no saved view key', async () => {
    render('?country=DE');
    await countryControl('Country: Germany');
    expect(screen.queryByRole('button', { name: /^Remove filter/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Saved view: Default(?!, edited)/ })).toBeInTheDocument();
  });

  it('the note names the country while one is chosen, and is absent for all countries', async () => {
    const chosen = render('?country=DE');
    expect(
      await screen.findByText('Only the prompts set in Germany are read. Prompts with no country are left out.'),
    ).toBeInTheDocument();
    chosen.unmount();
    render();
    await countryControl();
    expect(screen.queryByText(/Only the prompts set in/)).toBeNull();
  });

  it('the control is absent when no prompt has a country', async () => {
    server.use(
      http.get(mswPath(`${P}/prompts`), async ({ request }) => {
        const real = await getResponse([...handlers], request);
        const body = (await real?.json()) as { data: { country_iso: string | null }[] };
        return HttpResponse.json({ ...body, data: body.data.map((prompt) => ({ ...prompt, country_iso: null })) });
      }),
    );
    const reads = watch();
    render();
    await strip();
    // The project's own prompt list, not the sources/prompts read
    const promptList = (): URL[] => reads.filter((url) => url.pathname.endsWith(`/${fynix.project_id}/prompts`));
    await waitFor(() => expect(promptList().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByRole('combobox', { name: /^Country:/ })).toBeNull();
    expect(screen.queryByText(/^Country:/)).toBeNull();
  });

  it('the Domains, Pages and New and lost tabs all carry it', async () => {
    registry.real = true;
    const reads = watch();
    const list = { domains: '/ai/sources/domains', pages: '/ai/sources/pages', 'new-lost': '/ai/sources/changes' };
    for (const [tab, route] of Object.entries(list)) {
      reads.length = 0;
      const view = render(`?tab=${tab}&country=DE`);
      await waitFor(() => expect(to(reads, route).length).toBeGreaterThan(0));
      await strip();
      for (const url of [...to(reads, route), ...to(reads, '/ai/sources/diversity')]) {
        expect(url.searchParams.get(COUNTRY)).toBe('DE');
      }
      view.unmount();
    }
  });
});

describe('Citations page: the domain inspector', () => {
  const OPEN = 'fynix.digital';
  const DETAIL = '/ai/sources/domains/';
  const inspected = (name: string): Promise<HTMLElement> => screen.findByRole('complementary', { name });
  /** The address a write left: the last one `onUrlUpdate` saw. */
  const lastWrite = (writes: readonly string[]): URLSearchParams => new URLSearchParams(writes.at(-1));
  /** The domains the table links to, in its order: each link is the address of that domain's inspector. */
  async function listedDomains(): Promise<string[]> {
    const table = await screen.findByRole('treegrid', { name: 'Cited domains' });
    await waitFor(() => expect(within(table).queryAllByRole('rowheader').length).toBeGreaterThan(0));
    return within(table)
      .getAllByRole('link')
      .flatMap((link) => {
        const id = new URL(link.getAttribute('href') ?? '', 'https://app.test').searchParams.get('inspect');
        return id?.startsWith('domain:') === true ? [id.slice('domain:'.length)] : [];
      });
  }

  beforeEach(() => {
    registry.real = true;
  });

  it('makes the domain name of a row a link to its inspector', async () => {
    render();
    const domains = await listedDomains();
    expect(domains).toContain(OPEN);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('opens from a shared link, with the domain read in the page scope', async () => {
    const reads = watch();
    const { container } = render(`?inspect=domain:${OPEN}&engine=gemini_web&win=7d&role=own`);
    const inspector = await inspected(OPEN);
    expect(await within(inspector).findByRole('group', { name: 'Domain summary' })).toBeInTheDocument();
    await waitFor(() => expect(to(reads, `${DETAIL}${OPEN}`).length).toBeGreaterThan(0));
    const read = to(reads, `${DETAIL}${OPEN}`)[0];
    expect(read?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    expect(read?.searchParams.has('from')).toBe(true);
    // The detail is of the whole domain: the role filter narrows the table, not this
    expect(read?.searchParams.has('filter[domain_role_in]')).toBe(false);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens a domain that is not in the table, which has no position', async () => {
    render('?inspect=domain:nobody.example');
    const inspector = await inspected('nobody.example');
    expect(await within(inspector).findByText('Not cited in this window')).toBeInTheDocument();
    expect(within(inspector).queryByText(/^\d+ of \d+$/)).toBeNull();
    expect(within(inspector).queryByRole('button', { name: /^(Next|Previous) domain$/ })).toBeNull();
  });

  /** The domains the table lists for the page's scope, in its order: what the steps of the inspector go through. */
  async function tableOrder(): Promise<string[]> {
    const view = render();
    const domains = await listedDomains();
    view.unmount();
    expect(domains.length).toBeGreaterThan(2);
    return domains;
  }

  it('Previous and Next step through the listed domains in the order of the table and stop at the ends', async () => {
    const domains = await tableOrder();
    const [first, second] = domains;
    const last = domains.at(-1);
    if (first === undefined || second === undefined || last === undefined) throw new Error('The table has no domains');
    const writes: string[] = [];
    // From the first domain: there is none before it
    const view = render(`?inspect=domain:${first}`, { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    const inspector = await inspected(first);
    expect(await within(inspector).findByText(`1 of ${String(domains.length)}`)).toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: 'First domain in this list' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await view.user.click(within(inspector).getByRole('button', { name: 'Next domain' }));
    await waitFor(() => expect(lastWrite(writes).get('inspect')).toBe(`domain:${second}`));
    view.unmount();
    // From the last domain: there is none after it
    render(`?inspect=domain:${last}`);
    const end = await inspected(last);
    expect(await within(end).findByText(`${String(domains.length)} of ${String(domains.length)}`)).toBeInTheDocument();
    expect(within(end).getByRole('button', { name: 'Last domain in this list' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('steps with J and K from a row of the table, and keeps the tab of the inspector', async () => {
    const [first, second] = await tableOrder();
    if (first === undefined || second === undefined) throw new Error('The table has no domains');
    const writes: string[] = [];
    const { user } = render(`?inspect=domain:${first}&itab=pages`, {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await inspected(first);
    const table = await screen.findByRole('treegrid', { name: 'Cited domains' });
    await waitFor(() => expect(within(table).queryAllByRole('rowheader').length).toBeGreaterThan(0));
    const [row] = within(table).getAllByRole('rowheader');
    if (row === undefined) throw new Error('The table has no row');
    act(() => row.focus());
    await user.keyboard('j');
    await waitFor(() => expect(lastWrite(writes).get('inspect')).toBe(`domain:${second}`));
    // Stepping changes the domain and nothing else of the inspector: the tab it was on stays in the address
    expect(lastWrite(writes).get('itab')).toBe('pages');
  });

  it('closes on Escape and takes the inspector out of the address', async () => {
    const writes: string[] = [];
    const { user } = render(`?inspect=domain:${OPEN}&itab=pages&engine=gemini_web`, {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const inspector = await inspected(OPEN);
    await within(inspector).findByRole('group', { name: 'Domain summary' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(lastWrite(writes).has('inspect')).toBe(false));
    expect(lastWrite(writes).has('itab')).toBe(false);
    // The page's own scope stays
    expect(lastWrite(writes).get('engine')).toBe('gemini_web');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: OPEN })).toBeNull());
    // Focus goes back to the table, to the row the inspector was open on
    const table = screen.getByRole('treegrid', { name: 'Cited domains' });
    const row = within(table).getByRole('rowheader', { name: OPEN });
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('marks the open domain as the current row of the table', async () => {
    render(`?inspect=domain:${OPEN}`);
    const table = await screen.findByRole('treegrid', { name: 'Cited domains' });
    await waitFor(() =>
      expect(
        within(table)
          .getAllByRole('row')
          .filter((row) => row.getAttribute('aria-current') === 'true'),
      ).toHaveLength(1),
    );
  });

  it('is axe clean on a narrow phone, where the inspector is a sheet', async () => {
    vi.stubGlobal('innerWidth', 390);
    const { container } = render(`?inspect=domain:${OPEN}`);
    expect(await screen.findByRole('dialog', { name: OPEN })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
