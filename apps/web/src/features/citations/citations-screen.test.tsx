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

// The two tabs the page lists once T4b and T5a land, as text, so the shell is tested on its own
vi.mock('./citation-tabs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./citation-tabs')>();
  const entry = (id: 'domains' | 'pages', label: string): ReturnType<typeof actual.defineCitationTabs>[number] => ({
    id,
    label: () => label,
    render: () => `Panel of ${label}`,
  });
  return {
    ...actual,
    CITATION_TABS: actual.defineCitationTabs([entry('domains', 'Domains'), entry('pages', 'Pages')]),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
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

  it('says No new citation since a date when the newest citation is older than 7 days', async () => {
    server.use(
      http.get(mswPath(`${P}/ai/citations`), async ({ request }) => {
        const real = await getResponse([...handlers], request);
        const body = (await real?.json()) as { data: { observed_at: string }[] };
        return HttpResponse.json({
          ...body,
          data: body.data.map((row) => ({ ...row, observed_at: '2026-11-02T02:00:00Z' })),
        });
      }),
    );
    render();
    expect(await screen.findByText(/^No new citation since Nov 2, /)).toBeInTheDocument();
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

  it('counts the read of the previous period for the partial banner only while the comparison is on', async () => {
    server.use(
      http.get(DOMAINS, async ({ request }) => {
        const url = new URL(request.url);
        // The previous period is the one read that takes no `compare` and no `include`
        if (!url.searchParams.has('compare') && !url.searchParams.has('include')) return problem(request, 'not_found');
        return (await getResponse([...handlers], request)) ?? problem(request, 'not_found');
      }),
    );
    const on = render();
    expect(await screen.findByText('Some figures could not be loaded.')).toBeInTheDocument();
    on.unmount();
    render('?cmp=off');
    await strip();
    await waitFor(() => expect(cell('Citation units')).toHaveTextContent(/[\d,]{3,}/));
    expect(screen.queryByText('Some figures could not be loaded.')).toBeNull();
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

  it('the tab list writes the tab, and Domains writes nothing', async () => {
    const writes: string[] = [];
    const { user } = render('', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    await user.click(await screen.findByRole('tab', { name: 'Pages' }));
    await waitFor(() => expect(writes.at(-1)).toContain('tab=pages'));
    await user.click(screen.getByRole('tab', { name: 'Domains' }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('tab'));
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
