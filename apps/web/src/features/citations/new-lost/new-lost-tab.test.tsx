import { act, screen, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { getResponse, http, HttpResponse } from 'msw';
import type { Route } from 'next';
import { useMemo, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { NewLostTab } from './new-lost-tab';
import { usePreviousMeta, useScopeMeta } from '../citation-reads';
import { toFilters, useCitationScope } from '../citation-scope';
import type { CitationTabContext } from '../citation-tabs';
import { citationFilterFields } from '../citations-filters';
import messages from '../../../../messages/en.json';
import type { FilterValues } from '@/components/app/filters/types';
import type { EngineCode, SourceChangePage, SourceDomainPage } from '@/lib/citations/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
  useSearchParams: () => new URLSearchParams(),
}));

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const CHANGES = mswPath(`${P}/ai/sources/changes`);
const DOMAINS = mswPath(`${P}/ai/sources/domains`);
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SOURCE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const ENABLED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const LABELS = new Map<EngineCode, string>([
  ['chatgpt_web', 'ChatGPT'],
  ['gemini_web', 'Gemini'],
  ['google_ai_mode', 'AI Mode'],
]);
const labelOf = (code: EngineCode): string => LABELS.get(code) ?? code;

const NEWCOMER = 'agency-radar.example';
const FADED = 'legacy-seo-wiki.example';

const FIELDS = citationFilterFields({
  t: createTranslator({ locale: 'en', messages, namespace: 'citations.filters' }),
  flagWords: createTranslator({ locale: 'en', messages, namespace: 'citations.flagFilters' }),
  tab: 'new-lost',
  engines: ENABLED.map((code) => ({ code, label: labelOf(code) })),
  enginesLoading: false,
  roleUnits: null,
  topics: [],
  topicsLoading: false,
});

interface HarnessProps {
  values?: FilterValues;
  onClear?: () => void;
  registerExport?: CitationTabContext['registerExport'];
  /** What the page hands the tab to open its records in the inspector. */
  inspect?: CitationTabContext['inspect'];
}

/** The tab as the page gives it its context: the real scope from the address and the real scope reads. */
function Harness({ values = {}, onClear = () => undefined, registerExport, inspect }: HarnessProps): ReactElement {
  const { scope, range, setSearch } = useCitationScope('UTC', ENABLED);
  const filters = useMemo(() => toFilters(scope, range), [scope, range]);
  const scopeMeta = useScopeMeta(SOURCE, filters);
  const previousMeta = usePreviousMeta(SOURCE, filters, scopeMeta.data?.meta, scope.compare);
  const context: CitationTabContext = {
    source: SOURCE,
    workspaceSlug: 'digibranders',
    projectSlug: 'fynix',
    timeZone: 'UTC',
    scope: { ...scope, tab: 'new-lost' },
    filters,
    range,
    enabledEngines: ENABLED,
    labelOf,
    meta: scopeMeta,
    previousMeta,
    setSearch,
    registerExport,
    inspect,
    filterBar: { fields: FIELDS, values, onClear },
  };
  return (
    <div className="flex h-96 flex-col">
      <NewLostTab context={context} />
    </div>
  );
}

function renderTab(
  searchParams = '',
  options: ProvidedRenderOptions = {},
  props: HarnessProps = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<Harness {...props} />, { searchParams, ...options });
}

/** Every request the mock server saw for a route, as URLs. */
function watch(route: string): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(route)) seen.push(url);
  });
  return seen;
}

/** A promise a test settles itself, to hold an answer back. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
});

const newTable = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'New sources' });
const lostTable = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Lost sources' });
const names = (table: HTMLElement): string[] =>
  within(table)
    .queryAllByRole('rowheader')
    .map((header) => header.textContent ?? '');
const rowOf = (table: HTMLElement, name: string): HTMLElement => {
  const header = within(table).getByRole('rowheader', { name: new RegExp(name.replace('.', '\\.')) });
  const row = header.closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
};
/** The grid once its rows have loaded. */
async function loaded(table: Promise<HTMLElement> = newTable()): Promise<HTMLElement> {
  const found = await table;
  await waitFor(() => expect(names(found).length).toBeGreaterThan(0));
  return found;
}
const unitsIn = (row: HTMLElement): number => {
  const units = within(row).getByText(/^[\d,]+$/);
  return Number(units.textContent?.replace(/,/g, ''));
};

describe('NewLostTab', () => {
  it('lists the new domain with its units', async () => {
    renderTab();
    const table = await loaded();
    expect(names(table)).toEqual([expect.stringContaining(NEWCOMER)]);
    const row = rowOf(table, NEWCOMER);
    expect(unitsIn(row)).toBeGreaterThanOrEqual(2);
    expect(within(row).getByText('Third party')).toBeInTheDocument();
    // First and last cited are dates in the project's zone
    expect(within(row).getAllByText(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/)).toHaveLength(2);
    expect(within(table).getByRole('columnheader', { name: 'Citation units' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'First cited' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Last cited' })).toBeInTheDocument();
    expect(names(table).join()).not.toContain('example.com');
  });

  it('the Lost segment lists the lost domain with its units before', async () => {
    const { user } = renderTab();
    await loaded();
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    const table = await loaded(lostTable());
    expect(names(table)).toEqual([expect.stringContaining(FADED)]);
    expect(unitsIn(rowOf(table, FADED))).toBeGreaterThanOrEqual(2);
    expect(within(table).getByRole('columnheader', { name: 'Units before it went quiet' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'First cited' })).toBeNull();
    expect(screen.queryByRole('grid', { name: 'New sources' })).toBeNull();
  });

  it('writes the kind to the address, and New writes nothing', async () => {
    const writes: string[] = [];
    const { user } = renderTab('', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    await loaded();
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    await waitFor(() => expect(writes.at(-1)).toContain('kind=lost'));
    await user.click(screen.getByRole('radio', { name: /^New/ }));
    await waitFor(() => expect(writes.at(-1)).not.toContain('kind='));
  });

  it('a kind change drops the saved columns, which are named for the other table', async () => {
    const writes: string[] = [];
    const { user } = renderTab('cols=domain,units', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    await loaded();
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    await waitFor(() => expect(writes.at(-1)).toContain('kind=lost'));
    expect(writes.at(-1)).not.toContain('cols');
  });

  it('opens on Lost when the link says kind=lost', async () => {
    renderTab('kind=lost');
    const table = await loaded(lostTable());
    expect(names(table)).toEqual([expect.stringContaining(FADED)]);
    expect(screen.getByRole('radio', { name: /^Lost/ })).toBeChecked();
  });

  it('the segments carry their counts', async () => {
    renderTab();
    expect(await screen.findByRole('radio', { name: 'New 1' })).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: 'Lost 1' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'New or lost' })).toBeInTheDocument();
  });

  it('the rule is in MetricInfo and says Lost after 0 units in 2 following windows', async () => {
    const { user } = renderTab('kind=lost');
    await loaded(lostTable());
    await user.click(screen.getByRole('button', { name: 'About New and lost sources' }));
    expect(
      await screen.findByText('Lost after 0 units in 2 following windows, having had at least 2 units before them.', {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('A source is new when it starts to be cited and lost when it stops.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Methodology' })).toHaveAttribute('href', '/methodology');
  });

  it('the rule of New names the minimum and the days before', async () => {
    const { user } = renderTab('min=3');
    await loaded();
    await user.click(screen.getByRole('button', { name: 'About New and lost sources' }));
    expect(
      await screen.findByText('New: at least 3 citation units in this window and none in the 28 days before it.', {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it('says how many days the lost list reads, and says nothing of it on New', async () => {
    const { user } = renderTab();
    await loaded();
    const cost = /^Lost sources read 84 days of answers, three windows of 28 days, so this list can take a moment\.$/;
    expect(screen.queryByText(cost)).toBeNull();
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    expect(await screen.findByText(cost)).toBeInTheDocument();
  });

  it('shows a skeleton, not a spinner, while it loads', async () => {
    const held = gate();
    server.use(
      http.get(CHANGES, async ({ request }) => {
        await held.opened;
        return getResponse([...handlers], request);
      }),
    );
    renderTab();
    const table = await newTable();
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(names(table)).toHaveLength(0);
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => held.open());
    await loaded();
    expect(table).not.toHaveAttribute('aria-busy');
  });

  it('the other kind stays when one read fails, and Retry reads it again', async () => {
    let failing = true;
    server.use(
      http.get(CHANGES, ({ request }) => {
        if (failing && new URL(request.url).searchParams.get('kind') === 'lost') return problem(request, 'not_found');
        return getResponse([...handlers], request);
      }),
    );
    const { user } = renderTab();
    const table = await loaded();
    // New is whole, and says that the count of Lost could not be read
    expect(names(table)).toEqual([expect.stringContaining(NEWCOMER)]);
    expect(await screen.findByText('The count of lost sources could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Lost n/a' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    expect(await screen.findByText('The lost sources could not be loaded.')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const lost = await loaded(lostTable());
    expect(names(lost)).toEqual([expect.stringContaining(FADED)]);
    expect(screen.queryByText('The lost sources could not be loaded.')).toBeNull();
    expect(screen.queryByText('The count of lost sources could not be loaded.')).toBeNull();
  });

  it('a refresh that fails keeps the rows and says they are from the last read', async () => {
    let calls = 0;
    server.use(
      http.get(CHANGES, ({ request }) => {
        calls += 1;
        // The first two answer (New and Lost), the next to ask for New fails
        const kind = new URL(request.url).searchParams.get('kind');
        if (calls === 3 && kind === 'new') return problem(request, 'not_found');
        return getResponse([...handlers], request);
      }),
    );
    const { queryClient } = renderTab();
    const table = await loaded();
    await act(() =>
      queryClient.refetchQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes('"kind":"new"') }),
    );
    expect(
      await screen.findByText('The list could not be refreshed. The rows shown are from the last read.'),
    ).toBeInTheDocument();
    expect(names(table)).toEqual([expect.stringContaining(NEWCOMER)]);
  });

  it('empty New names the minimum', async () => {
    renderTab('min=1000');
    expect(await screen.findByRole('heading', { name: 'No new source' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'No source reached 1,000 units in this window without being cited in the 28 days before it. Lower the minimum or choose another window.',
      ),
    ).toBeInTheDocument();
  });

  it('empty New offers to reset a raised minimum, and the reset puts the default back', async () => {
    const writes: string[] = [];
    const { user } = renderTab('min=1000', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    await screen.findByRole('heading', { name: 'No new source' });
    await user.click(screen.getByRole('button', { name: 'Reset the minimum to 2' }));
    await waitFor(() => expect(writes.at(-1)).toBeDefined());
    expect(writes.at(-1)).not.toContain('min=');
    expect(names(await loaded())).toEqual([expect.stringContaining(NEWCOMER)]);
  });

  it('empty New at the default minimum offers no action and keeps the reason', async () => {
    server.use(
      http.get(CHANGES, async ({ request }) => {
        const real = await getResponse([...handlers], request);
        const body = (await real?.json()) as SourceChangePage;
        return HttpResponse.json({ ...body, data: [], page: { ...body.page, total: 0 } });
      }),
    );
    renderTab();
    expect(await screen.findByRole('heading', { name: 'No new source' })).toBeInTheDocument();
    expect(screen.getByText(/Lower the minimum or choose another window\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reset the minimum/ })).toBeNull();
  });

  it('the rule and the empty reason count the days of the previous period, not of the asked window', async () => {
    // A previous period of 14 days against an asked window of 28
    server.use(
      http.get(CHANGES, async ({ request }) => {
        const real = await getResponse([...handlers], request);
        const body = (await real?.json()) as SourceChangePage;
        const to = Date.parse(body.meta.compare_window.to);
        const from = new Date(to - 13 * 86_400_000).toISOString().slice(0, 10);
        return HttpResponse.json({
          ...body,
          data: [],
          page: { ...body.page, total: 0 },
          meta: { ...body.meta, compare_window: { ...body.meta.compare_window, from } },
        });
      }),
    );
    const { user } = renderTab('min=3');
    expect(
      await screen.findByText(
        'No source reached 3 units in this window without being cited in the 14 days before it. Lower the minimum or choose another window.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'About New and lost sources' }));
    expect(
      await screen.findByText('New: at least 3 citation units in this window and none in the 14 days before it.', {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it('empty Lost names the days it needs behind the window', async () => {
    renderTab('kind=lost&min=1000');
    expect(await screen.findByRole('heading', { name: 'No lost source' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'A source is lost after it was cited in one window and not at all in the 2 windows after it, so a lost source needs 84 days of answers behind this window.',
      ),
    ).toBeInTheDocument();
  });

  it('a filter that leaves no row names the filters and offers Clear filters', async () => {
    const onClear = vi.fn();
    const { user } = renderTab('role=own', {}, { values: { role: { kind: 'enum', values: ['own'] } }, onClear });
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('says that nothing is new, and that nothing can be lost, when the previous period has no answers', async () => {
    server.use(
      http.get(DOMAINS, async ({ request }) => {
        const real = await getResponse([...handlers], request);
        const body = (await real?.json()) as SourceDomainPage;
        return HttpResponse.json({ ...body, meta: { ...body.meta, previous_answers: 0 } });
      }),
    );
    const { user } = renderTab();
    expect(await screen.findByText('The previous period has no answers, so nothing is new.')).toBeInTheDocument();
    expect(names(await newTable())).toHaveLength(0);
    // No count is drawn: it would be a count of every domain
    expect(await screen.findByRole('radio', { name: 'New n/a' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    expect(await screen.findByText('The earlier periods have no answers, so nothing can be lost.')).toBeInTheDocument();
  });

  it('a larger minimum keeps the rows while it reads', async () => {
    const held = gate();
    server.use(
      http.get(CHANGES, async ({ request }) => {
        if (new URL(request.url).searchParams.get('min_support') === '1') await held.opened;
        return getResponse([...handlers], request);
      }),
    );
    const { user } = renderTab();
    const table = await loaded();
    await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
    await user.click(await screen.findByRole('option', { name: 'At least 1 unit' }));
    await waitFor(() => expect(table).toHaveAttribute('aria-busy', 'true'));
    expect(names(table)).toEqual([expect.stringContaining(NEWCOMER)]);
    act(() => held.open());
    await waitFor(() => expect(table).not.toHaveAttribute('aria-busy'));
  });

  it('flags are off by default and on with redirects=include', async () => {
    const off = watch('/sources/changes');
    const first = renderTab();
    await loaded();
    expect(off.length).toBeGreaterThan(0);
    for (const url of off) {
      expect(url.searchParams.has('include_unresolved_redirects')).toBe(false);
      expect(url.searchParams.has('include_engine_internal')).toBe(false);
    }
    first.unmount();
    server.events.removeAllListeners();
    const on = watch('/sources/changes');
    const scope = watch('/sources/domains');
    renderTab('redirects=include');
    await loaded();
    expect(on.length).toBeGreaterThan(0);
    for (const url of [...on, ...scope]) {
      expect(url.searchParams.get('include_unresolved_redirects')).toBe('true');
      expect(url.searchParams.has('include_engine_internal')).toBe(false);
    }
  });

  it('sends the engine-internal flag too', async () => {
    const seen = watch('/sources/changes');
    renderTab('internal=include');
    await loaded();
    for (const url of seen) expect(url.searchParams.get('include_engine_internal')).toBe('true');
  });

  it('finds a listed domain by its name', async () => {
    const { user } = renderTab();
    await loaded();
    const search = screen.getByRole('searchbox', { name: /search/i });
    expect(search).toHaveAttribute('placeholder', 'Search listed domains');
    await user.type(search, 'nothing-like-it');
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'radar');
    await waitFor(() => expect(names(screen.getByRole('grid', { name: 'New sources' }))).toHaveLength(1));
  });

  describe('and the domain inspector', () => {
    type Inspect = NonNullable<CitationTabContext['inspect']>;
    function inspecting(target: Inspect['target'] = null): { inspect: Inspect; open: Mock; setOrder: Mock } {
      const open = vi.fn();
      const setOrder = vi.fn();
      return {
        open,
        setOrder,
        inspect: {
          target,
          open,
          setOrder,
          hrefOf: (next) => `/digibranders/fynix/ai/citations?inspect=${next.type}:${next.id}` as Route,
        },
      };
    }

    it('opens the domain of a row in the inspector', async () => {
      const { inspect, open } = inspecting();
      const { user } = renderTab('', {}, { inspect });
      const table = await loaded();
      await user.click(within(rowOf(table, NEWCOMER)).getByRole('rowheader'));
      expect(open).toHaveBeenCalledWith({ type: 'domain', id: NEWCOMER }, 'inspector');
    });

    it('reports the domains of the list on screen, New first and then Lost', async () => {
      const { inspect, setOrder } = inspecting();
      const { user } = renderTab('', {}, { inspect });
      await loaded();
      await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('domain', [NEWCOMER]));
      await user.click(screen.getByRole('radio', { name: /^Lost/ }));
      await loaded(lostTable());
      await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('domain', [FADED]));
    });

    it('marks the open domain as the current row', async () => {
      const { inspect } = inspecting({ type: 'domain', id: NEWCOMER });
      renderTab('', {}, { inspect });
      const table = await loaded();
      expect(rowOf(table, NEWCOMER)).toHaveAttribute('aria-current', 'true');
    });
  });

  it('hands the page no rows to export', async () => {
    const register = vi.fn();
    renderTab('', {}, { registerExport: register });
    await loaded();
    expect(register).toHaveBeenCalled();
    for (const call of register.mock.calls) expect(call[0]).toBeNull();
  });

  it('adds no status colour: the role badges are neutral and there is no tone class', async () => {
    const { user } = renderTab();
    const table = await loaded();
    const tone = /(?:text|bg|border)-(?:positive|negative|warning|success|danger|info)/;
    expect(table.innerHTML).not.toMatch(tone);
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    const lost = await loaded(lostTable());
    expect(lost.innerHTML).not.toMatch(tone);
    expect(within(lost).getByText('Third party').className).not.toMatch(tone);
  });

  it.each(['new', 'lost'])('is axe clean for %s', async (kind) => {
    const { container } = renderTab(`kind=${kind}`);
    await loaded(kind === 'new' ? newTable() : lostTable());
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is axe clean in the dark theme', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container } = renderTab();
    await loaded();
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.removeAttribute('data-theme');
  });
});
