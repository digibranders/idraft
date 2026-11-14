import { act, screen, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import { useMemo, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { toFilters, useCitationScope } from './citation-scope';
import type { CitationRead } from './citation-reads';
import { activeCitationTab, CITATION_TABS, type CitationTabContext } from './citation-tabs';
import { citationFilterFields } from './citations-filters';
import { PagesTab } from './pages-tab';
import messages from '../../../messages/en.json';
import type { FilterValues } from '@/components/app/filters/types';
import type {
  EngineCode,
  EngineRoleUnits,
  MetricCell,
  SourceDomainPage,
  SourceDomainRow,
  SourcePagePage,
  SourcePageRow,
  SourcesMeta,
} from '@/lib/citations/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const DOMAINS = mswPath(`${P}/ai/sources/domains`);
const PAGES = mswPath(`${P}/ai/sources/pages`);
const ENABLED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const LABELS = new Map<EngineCode, string>([
  ['chatgpt_web', 'ChatGPT'],
  ['gemini_web', 'Gemini'],
  ['google_ai_mode', 'AI Mode'],
]);
const NO_ENGINES: readonly EngineCode[] = [];
const labelOf = (code: EngineCode): string => LABELS.get(code) ?? code;
const SOURCE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: 'p-fynix' };

const share = (units: number, total = 18420): MetricCell => ({
  value: total === 0 ? null : units / total,
  numerator: units,
  denominator: total,
  n_observations: 4812,
});
const block = (code: EngineCode, thirdParty: number): EngineRoleUnits => ({
  engine_code: code,
  own: { citation_units: 0, answers_citing: 0 },
  competitor: { citation_units: 0, answers_citing: 0 },
  third_party: { citation_units: thirdParty, answers_citing: 0 },
});
const META: SourcesMeta = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: [...ENABLED],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [{ domain_role: 'third_party', citation_units: 18420, observations: 4000 }],
  by_role_by_engine: [block('chatgpt_web', 7000), block('gemini_web', 6000), block('google_ai_mode', 5420)],
  compare_window: { from: '2026-09-18', to: '2026-10-15', timezone: 'UTC' },
  previous_answers: 4500,
  series: [{ week_start: '2026-10-19', answers: 1200, citation_units: 4000, distinct_domains: 300 }],
};

const pageOf = (id: number, overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: id,
  url: `https://g2.com/products/p${String(id)}`,
  title: `Page ${String(id)}`,
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 300,
  observations: 120,
  prompts: 20,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 300 },
    { engine_code: 'gemini_web', citation_units: 0 },
  ],
  source_share: share(300),
  previous: { citation_units: 100, observations: 40 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [{ week_start: '2026-10-19', citation_units: 100, observations: 40 }],
  ...overrides,
});
const ONE = pageOf(1);
const TWO = pageOf(2, {
  url: 'https://hubspot.com/blog/crm',
  host: 'hubspot.com',
  registrable_domain: 'hubspot.com',
  domain_role: 'competitor',
  role_entity_id: 'ent-hubspot',
  title: 'The CRM guide',
  citation_units: 200,
  source_share: share(200),
});
const OWN = pageOf(3, {
  url: 'https://fynix.com/pricing',
  host: 'fynix.com',
  registrable_domain: 'fynix.com',
  domain_role: 'own',
  role_entity_id: 'ent-own',
  title: 'Pricing',
  citation_units: 4,
  source_share: share(4),
});

const domainOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1912,
  observations: 640,
  prompts: 48,
  engines: [],
  source_share: share(1912),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  cited_with: null,
  ...overrides,
});
const G2_DOMAIN = domainOf();
const HUBSPOT_DOMAIN = domainOf({
  registrable_domain: 'hubspot.com',
  domain_role: 'competitor',
  role_entity_id: 'ent-hubspot',
  cited_with: { entity_id: 'ent-hubspot', observations: 12 },
});

const pagePage = (rows: readonly SourcePageRow[], meta: SourcesMeta = META, total = rows.length): SourcePagePage => ({
  data: [...rows],
  page: { limit: 200, offset: 0, total },
  meta,
});
const domainPage = (rows: readonly SourceDomainRow[]): SourceDomainPage => ({
  data: [...rows],
  page: { limit: 200, offset: 0, total: rows.length },
  meta: META,
});

/** Every request of the tab's table the mock server saw for a route, as URLs: the reads of the no own page card ask for one prompt. */
function watch(route: string): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(route) && !url.searchParams.has('filter[prompt_id]')) seen.push(url);
  });
  return seen;
}

/** Answers the pages route with `rows`; a row below `min_support` and a page of another domain are left out, as the API does. */
function servePages(
  rows: readonly SourcePageRow[],
  { meta = META, total }: { meta?: SourcesMeta; total?: number } = {},
): void {
  server.use(
    http.get(PAGES, ({ request }) => {
      const query = new URL(request.url).searchParams;
      const min = Number(query.get('min_support') ?? '1');
      const domain = query.get('filter[registrable_domain]');
      const kept = rows.filter(
        (row) => row.citation_units >= min && (domain === null || row.registrable_domain === domain),
      );
      return HttpResponse.json(pagePage(kept, meta, total ?? kept.length));
    }),
  );
}
const serveDomains = (rows: readonly SourceDomainRow[]): void =>
  server.use(http.get(DOMAINS, () => HttpResponse.json(domainPage(rows))));

/** A promise a test settles itself, to hold an answer back. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

const read = <TPage,>(data: TPage): CitationRead<TPage> => ({
  status: 'ready',
  data,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

const filterT = createTranslator({ locale: 'en', messages, namespace: 'citations.filters' });
const FIELDS = citationFilterFields({
  t: filterT,
  tab: 'pages',
  engines: ENABLED.map((code) => ({ code, label: labelOf(code) })),
  enginesLoading: false,
  roleUnits: null,
  topics: [],
  topicsLoading: false,
});

interface HarnessProps {
  values?: FilterValues;
  onClear?: () => void;
  /** The engines that are on; keep it stable between renders. */
  engines?: readonly EngineCode[];
  timeZone?: string;
  /** What the page's Export button is handed. */
  registerExport?: CitationTabContext['registerExport'];
  /** What the page hands the tab to open its records in the inspector. */
  inspect?: CitationTabContext['inspect'];
}

/**
 * The tab as the page gives it its context: the real scope from the address, and the strip's reads. The filter
 * bar holds the Domain filter the address names, and clearing it writes the address, as the page does.
 */
function Harness({
  values,
  onClear = () => undefined,
  engines = ENABLED,
  timeZone = 'UTC',
  registerExport,
  inspect,
}: HarnessProps): ReactElement {
  const { scope, range, setSearch } = useCitationScope(timeZone, engines);
  const filters = useMemo(() => toFilters(scope, range), [scope, range]);
  const strip = useMemo(() => read(domainPage([])), []);
  const previous = useMemo(() => read({ ...domainPage([]), meta: { ...META, citation_units: 13280 } }), []);
  const fromAddress: FilterValues =
    scope.domain === null ? {} : { domain: { kind: 'text', operator: 'equals', text: scope.domain } };
  const context: CitationTabContext = {
    source: SOURCE,
    workspaceSlug: 'digibranders',
    projectSlug: 'fynix',
    timeZone,
    scope,
    filters,
    range,
    enabledEngines: engines,
    labelOf,
    meta: strip,
    previousMeta: previous,
    setSearch,
    registerExport,
    inspect,
    filterBar: {
      fields: FIELDS,
      values: values ?? fromAddress,
      onClear: () => {
        onClear();
        setSearch({ domain: null });
      },
    },
  };
  return (
    <>
      <p data-testid="strip">{`Strip ${String(strip.data?.meta.citation_units)}`}</p>
      <div className="flex h-96 flex-col">
        <PagesTab context={context} />
      </div>
    </>
  );
}

/** The Pages tab is the one the address names. */
function renderTab(
  searchParams = '',
  options: ProvidedRenderOptions = {},
  props: HarnessProps = {},
): ReturnType<typeof renderWithProviders> {
  const query = `tab=pages${searchParams === '' ? '' : `&${searchParams}`}`;
  return renderWithProviders(<Harness {...props} />, { searchParams: query, ...options });
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  servePages([ONE, TWO]);
  serveDomains([G2_DOMAIN, HUBSPOT_DOMAIN]);
  // The no own page card above the table: every prompt has an own page here, so it reads two empty lists and says so
  server.use(
    http.get(mswPath(`${P}/ai/sources/prompts`), () =>
      HttpResponse.json({
        data: [],
        page: { has_more: false, limit: 10, next_cursor: null },
        meta: { window: META.window, include_branded: false, engine_codes: [...ENABLED] },
      }),
    ),
    http.get(mswPath(`${P}/prompts`), () =>
      HttpResponse.json({ data: [], page: { has_more: false, limit: 200, next_cursor: null } }),
    ),
  );
  // The one entity "Cited with" names
  server.use(
    http.get(mswPath(`${P}/entities`), () =>
      HttpResponse.json({ data: [{ entity: { entity_id: 'ent-hubspot', canonical_name: 'HubSpot' } }] }),
    ),
  );
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
});

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Cited pages' });
/** The grid once its rows have loaded. */
async function loaded(): Promise<HTMLElement> {
  const found = await grid();
  await waitFor(() => expect(within(found).queryAllByRole('rowheader').length).toBeGreaterThan(0));
  return found;
}
const names = (table: HTMLElement): string[] =>
  within(table)
    .getAllByRole('rowheader')
    .map((header) => header.textContent ?? '');
const rowOf = (table: HTMLElement, text: string): HTMLElement => {
  const row = within(table).getByText(text).closest('tr');
  if (row === null) throw new Error(`No row for ${text}`);
  return row;
};
/** Nothing in flight, so a read that was going to start has started: the log then says whether it did. */
const idle = (client: ReturnType<typeof renderTab>['queryClient']): Promise<void> =>
  waitFor(() => expect(client.isFetching()).toBe(0));

describe('the tab list', () => {
  it('has Domains, Pages and New and lost, and tab=pages is chosen by the address', () => {
    expect(CITATION_TABS.map((tab) => tab.id)).toEqual(['domains', 'pages', 'new-lost']);
    expect(activeCitationTab(CITATION_TABS, 'pages')?.id).toBe('pages');
    const words = createTranslator({ locale: 'en', messages, namespace: 'citations' });
    expect(CITATION_TABS.map((tab) => tab.label(words))).toEqual(['Domains', 'Pages', 'New and lost']);
  });
});

describe('PagesTab', () => {
  it('lists the pages of the scope in the order the server gave', async () => {
    servePages([TWO, ONE]);
    renderTab();
    const table = await loaded();
    expect(names(table)).toEqual([expect.stringContaining('hubspot.com'), expect.stringContaining('g2.com')]);
  });

  it('asks the server for 200 pages with the sort, the minimum and the comparison, and no include block', async () => {
    const seen = watch('/sources/pages');
    renderTab();
    await loaded();
    const query = seen[0]?.searchParams;
    expect(query?.get('limit')).toBe('200');
    expect(query?.has('offset')).toBe(false);
    expect(query?.get('min_support')).toBe('2');
    expect(query?.get('compare')).toBe('previous_period');
    // No column of the table draws a trend, so no series is asked for
    expect(query?.has('include')).toBe(false);
    expect(query?.has('sort')).toBe(false);
    expect(query?.has('filter[registrable_domain]')).toBe(false);
  });

  it('never sends include=cited_with to the pages route', async () => {
    const seen = watch('/sources/pages');
    const { queryClient } = renderTab('engine=chatgpt_web&role=third_party&sort=-prompts');
    await loaded();
    await idle(queryClient);
    expect(seen.length).toBeGreaterThan(0);
    for (const url of seen) expect(url.searchParams.get('include') ?? '').not.toContain('cited_with');
  });

  it('reads Cited with from the domains route, 200 of them with the blocks it needs, in the scope of the page', async () => {
    const seen = watch('/sources/domains');
    renderTab('engine=chatgpt_web&role=third_party&min=5');
    await loaded();
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const query = seen[0]?.searchParams;
    expect(query?.get('limit')).toBe('200');
    expect(query?.get('include')).toBe('cited_with');
    expect(query?.get('filter[engine_code_in]')).toBe('chatgpt_web');
    expect(query?.get('filter[domain_role_in]')).toBe('third_party');
    // The pages are narrowed by the minimum, the domain a page is joined to is not
    expect(query?.has('min_support')).toBe(false);
    expect(query?.has('filter[registrable_domain]')).toBe(false);
  });

  it('passes the domain key as the registrable domain of the pages read', async () => {
    const seen = watch('/sources/pages');
    renderTab('domain=equals:g2.com');
    const table = await loaded();
    expect(seen[0]?.searchParams.get('filter[registrable_domain]')).toBe('g2.com');
    expect(names(table)).toEqual([expect.stringContaining('g2.com')]);
    expect(within(table).queryByText('The CRM guide')).toBeNull();
  });

  it('filters to one domain from the domain key and shows it as a chip when nothing is left', async () => {
    servePages([]);
    renderTab('domain=equals:g2.com');
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.getByText('Domain equals: g2.com')).toBeInTheDocument();
  });

  it('the empty state Clear filters resets the Domain filter and lists every page', async () => {
    // A domain that has no page in the scope: filtered to it the list is empty
    servePages([ONE, TWO]);
    const onClear = vi.fn();
    const { user } = renderTab('domain=equals:nothing.example', {}, { onClear });
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.getByText('Domain equals: nothing.example')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
    const table = await loaded();
    expect(names(table)).toHaveLength(2);
  });

  it('shows the page, the host and the title as text, beside its share of the same total', async () => {
    servePages([pageOf(1, { title: '<img src=x onerror=alert(1)>' })]);
    const { container } = renderTab();
    const table = await loaded();
    const row = rowOf(table, '<img src=x onerror=alert(1)>');
    expect(row).toHaveTextContent('g2.com');
    expect(row).toHaveTextContent('1.6%');
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });

  it('puts the Answers and Prompts columns in the chooser, hidden until chosen', async () => {
    const updates: string[] = [];
    const { user } = renderTab('', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    const table = await loaded();
    expect(within(table).queryByRole('columnheader', { name: 'Answers' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Answers' }));
    expect(await within(table).findByRole('columnheader', { name: 'Answers' })).toBeInTheDocument();
    expect(updates.some((query) => query.includes('cols='))).toBe(true);
  });

  it('shows the share by engine under one heading, and First seen, Last seen and Cited with (domain)', async () => {
    renderTab();
    const table = await loaded();
    expect(within(table).getByRole('columnheader', { name: 'Share by engine' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'First seen' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Last seen' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Cited with (domain)' })).toBeInTheDocument();
  });

  it('reads the engine totals of the share by engine from the scope read, for the pages route returns none', async () => {
    servePages([ONE], { meta: { ...META, by_role_by_engine: null } });
    renderTab();
    const table = await loaded();
    // 300 of the 7,000 units of ChatGPT
    expect(rowOf(table, 'Page 1')).toHaveTextContent('4.3%');
  });

  it('shows first and last seen in the time zone of the project', async () => {
    renderTab('', {}, { timeZone: 'Asia/Kolkata' });
    const table = await loaded();
    // 08:00 UTC is 13:30 in Kolkata
    expect(rowOf(table, 'Page 1')).toHaveTextContent('Oct 20, 13:30');
  });

  it('a row click opens nothing when the page offers no inspector', async () => {
    const { user } = renderTab();
    const table = await loaded();
    await user.click(within(table).getByText('Page 1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(table).queryByRole('row', { selected: true })).toBeNull();
  });

  it('names the domain Cited with for each page, and says in words when the domain is outside the 200', async () => {
    servePages([
      ONE,
      TWO,
      pageOf(9, {
        url: 'https://elsewhere.org/a',
        host: 'elsewhere.org',
        registrable_domain: 'elsewhere.org',
        title: 'Elsewhere',
      }),
    ]);
    renderTab();
    const table = await loaded();
    await waitFor(() => expect(rowOf(table, 'The CRM guide')).toHaveTextContent('HubSpot'));
    expect(rowOf(table, 'Page 1')).toHaveTextContent('None named');
    expect(rowOf(table, 'Elsewhere')).toHaveTextContent('Outside the 200 most cited domains');
  });

  it('says Cited with could not be loaded, keeps the table and retries', async () => {
    let failing = true;
    server.use(
      http.get(DOMAINS, ({ request }) =>
        failing ? problem(request, 'not_found') : HttpResponse.json(domainPage([G2_DOMAIN, HUBSPOT_DOMAIN])),
      ),
    );
    const { user } = renderTab();
    const table = await loaded();
    // The words are also the description of each Cited with cell: the banner is the paragraph
    const words = 'Cited with could not be loaded. The other columns are complete.';
    await waitFor(() => expect(screen.getAllByText(words).some((line) => line.tagName === 'P')).toBe(true));
    expect(names(table)).toHaveLength(2);
    expect(rowOf(table, 'The CRM guide')).not.toHaveTextContent('None named');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rowOf(table, 'The CRM guide')).toHaveTextContent('HubSpot'));
    expect(screen.queryAllByText(words)).toHaveLength(0);
  });

  it('asks again for the minimum chosen and leaves the strip as it was', async () => {
    const seen = watch('/sources/pages');
    servePages([ONE, TWO, OWN]);
    const updates: string[] = [];
    const { user } = renderTab('', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    const table = await loaded();
    // the default minimum, 2, leaves the 4 unit page in; 10 leaves it out
    expect(names(table)).toHaveLength(3);
    await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
    await user.click(await screen.findByRole('option', { name: 'At least 10 units' }));
    await waitFor(() => expect(names(table)).toHaveLength(2));
    expect(seen.at(-1)?.searchParams.get('min_support')).toBe('10');
    expect(updates.at(-1)).toContain('min=10');
    expect(screen.getByTestId('strip')).toHaveTextContent('Strip 18420');
  });

  it('the sort select writes sort and asks the server, and drops it for the default', async () => {
    const seen = watch('/sources/pages');
    const updates: string[] = [];
    const { user } = renderTab('', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    await loaded();
    const select = screen.getByRole('combobox', { name: 'Order by' });
    expect(select).toHaveTextContent('Citation units');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Prompts' }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('sort')).toBe('-prompts'));
    expect(updates.at(-1)).toContain('sort=-prompts');
    await user.click(screen.getByRole('combobox', { name: 'Order by' }));
    await user.click(await screen.findByRole('option', { name: 'Citation units' }));
    await waitFor(() => expect(updates.at(-1)).not.toContain('sort='));
  });

  it('leaves the stray share scope line off the page, keeping it in the share header tooltip', async () => {
    renderTab();
    await loaded();
    expect(screen.queryAllByText(/^Shares are of/).some((el) => el.tagName === 'P')).toBe(false);
  });

  it('says the 200 most cited pages are listed of N above 200 in the footer', async () => {
    servePages([ONE, TWO], { total: 1204 });
    renderTab();
    await loaded();
    expect(screen.getByText(/2 of 1,204 pages\. Raise the minimum to see more/)).toBeInTheDocument();
  });

  it('says nothing when every page is listed', async () => {
    renderTab();
    await loaded();
    expect(screen.queryByText(/Raise the minimum to see more/)).toBeNull();
  });

  it('leaves the full width no previous answers banner off the table', async () => {
    servePages([ONE, TWO], { meta: { ...META, previous_answers: 0 } });
    renderTab();
    await loaded();
    expect(screen.queryByText(/previous period has no answers/)).toBeNull();
  });

  it('marks a page New when it was not cited in the previous period', async () => {
    servePages([pageOf(1, { previous: { citation_units: 0, observations: 0 } }), TWO]);
    renderTab();
    const table = await loaded();
    expect(rowOf(table, 'Page 1')).toHaveTextContent('New');
    expect(rowOf(table, 'The CRM guide')).not.toHaveTextContent('New');
  });

  it('filtered to nothing says why, names the filters and offers Clear filters', async () => {
    servePages([]);
    const onClear = vi.fn();
    const { user } = renderTab('', {}, { values: { role: { kind: 'enum', values: ['own'] } }, onClear });
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.getByText('Role: Own')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('a minimum that leaves no page says so and Clear filters puts it back to the default', async () => {
    servePages([TWO]);
    const updates: string[] = [];
    const { user } = renderTab('min=1000', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.getByText('Lower the fewest citation units to see more rows.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(updates.at(-1)).not.toContain('min=');
    expect((await loaded()).querySelectorAll('[role="rowheader"]').length).toBeGreaterThan(0);
  });

  it('the default minimum that hides every cited page says to lower it', async () => {
    servePages([pageOf(1, { citation_units: 1, source_share: share(1) })], {
      meta: { ...META, citation_units: 1 },
    });
    renderTab();
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.getByText('Lower the fewest citation units to see more rows.')).toBeInTheDocument();
  });

  it('says there are no citations yet, with a way to the prompts, when no answer was read', async () => {
    servePages([], { meta: { ...META, answers: 0, answers_citing: 0, citation_units: 0, by_role: [] } });
    renderTab();
    expect(await screen.findByRole('heading', { name: 'No citations yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Topics and Prompts' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/prompts',
    );
  });

  it('says the answers cite no source when answers were read and none names one', async () => {
    servePages([], { meta: { ...META, answers: 12, answers_citing: 0, citation_units: 0, by_role: [] } });
    renderTab();
    expect(await screen.findByRole('heading', { name: 'The answers cite no source' })).toBeInTheDocument();
    expect(screen.getByText('12 answers were read in this window and none names a source.')).toBeInTheDocument();
  });

  it('a filter that leaves no answer is not "No citations yet": it names the filter and offers Clear filters', async () => {
    servePages([], { meta: { ...META, answers: 0, answers_citing: 0, citation_units: 0, by_role: [] } });
    renderTab('', {}, { values: { topic: { kind: 'enum', values: ['t-security'] } } });
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No citations yet' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('finds a listed page by its address or its title and says so when none matches', async () => {
    const { user } = renderTab();
    const table = await loaded();
    const search = screen.getByRole('searchbox', { name: 'Search in table' });
    expect(search).toHaveAttribute('placeholder', 'Search listed pages');
    await user.type(search, 'crm');
    await waitFor(() => expect(names(table)).toEqual([expect.stringContaining('hubspot.com')]));
    await user.clear(search);
    await user.type(search, 'PAGE 1');
    await waitFor(() => expect(names(table)).toEqual([expect.stringContaining('g2.com')]));
    await user.clear(search);
    await user.type(search, 'nothing');
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
  });

  it('shows skeleton rows while loading and keeps the rows while it reads again', async () => {
    const first = gate();
    const second = gate();
    let calls = 0;
    server.use(
      http.get(PAGES, async ({ request }) => {
        calls += 1;
        await (calls === 1 ? first.opened : second.opened);
        const min = Number(new URL(request.url).searchParams.get('min_support') ?? '1');
        return HttpResponse.json(pagePage([ONE, TWO].filter((row) => row.citation_units >= min)));
      }),
    );
    const { user } = renderTab();
    const table = await grid();
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(within(table).queryAllByRole('rowheader')).toHaveLength(0);
    act(() => first.open());
    await loaded();
    expect(table).not.toHaveAttribute('aria-busy');
    await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
    await user.click(await screen.findByRole('option', { name: 'At least 3 units' }));
    await waitFor(() => expect(table).toHaveAttribute('aria-busy', 'true'));
    expect(names(table)).toHaveLength(2);
    act(() => second.open());
    await waitFor(() => expect(table).not.toHaveAttribute('aria-busy'));
  });

  it('a failed read shows an inline error with Retry and keeps the toolbar', async () => {
    let calls = 0;
    server.use(
      http.get(PAGES, ({ request }) => {
        calls += 1;
        if (calls === 1) return problem(request, 'not_found');
        return HttpResponse.json(pagePage([ONE, TWO]));
      }),
    );
    const { user } = renderTab();
    expect(await screen.findByText('Citations could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Order by' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
    expect(screen.queryByText('Citations could not be loaded')).toBeNull();
  });

  it('a refresh that fails keeps the rows, says they are from the last read and offers Retry', async () => {
    let calls = 0;
    server.use(
      http.get(PAGES, ({ request }) => {
        calls += 1;
        if (calls === 2) return problem(request, 'not_found');
        return HttpResponse.json(pagePage([ONE, TWO]));
      }),
    );
    const { user, queryClient } = renderTab();
    const table = await loaded();
    expect(screen.queryByText('The list could not be refreshed. The rows shown are from the last read.')).toBeNull();
    await act(() => queryClient.refetchQueries());
    expect(
      await screen.findByText('The list could not be refreshed. The rows shown are from the last read.'),
    ).toBeInTheDocument();
    expect(names(table)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.queryByText('The list could not be refreshed. The rows shown are from the last read.')).toBeNull(),
    );
    expect(names(table)).toHaveLength(2);
  });

  it('the own row is tinted and says Own in words', async () => {
    servePages([OWN, ONE]);
    renderTab();
    const table = await loaded();
    const own = rowOf(table, 'Pricing');
    expect(own).toHaveAttribute('data-tone', 'own');
    expect(within(own).getByText('Own')).toBeInTheDocument();
    expect(rowOf(table, 'Page 1')).not.toHaveAttribute('data-tone');
  });

  it('reads nothing while another tab is the one shown', async () => {
    const pages = watch('/sources/pages');
    const domains = watch('/sources/domains');
    const { queryClient } = renderWithProviders(<Harness />, { searchParams: 'tab=domains' });
    await idle(queryClient);
    expect(pages).toHaveLength(0);
    expect(domains).toHaveLength(0);
  });

  it('reads nothing while the engines are not known: an empty list would mean every engine', async () => {
    const pages = watch('/sources/pages');
    const domains = watch('/sources/domains');
    const { queryClient } = renderTab('engine=chatgpt_web', {}, { engines: NO_ENGINES });
    await idle(queryClient);
    expect(pages).toHaveLength(0);
    expect(domains).toHaveLength(0);
    expect(screen.queryByRole('grid', { name: 'Cited pages' })?.getAttribute('aria-busy')).toBe('true');
  });

  it('shows the prompts with no own page above the table', async () => {
    renderTab();
    const card = await screen.findByRole('region', { name: 'Prompts with no own page cited' });
    const table = await grid();
    expect(card.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hands the page its listed rows and the total of the scope for the export, and takes them back on leaving', async () => {
    const register = vi.fn();
    const { unmount } = renderTab('', {}, { registerExport: register });
    await loaded();
    await waitFor(() =>
      expect(register).toHaveBeenLastCalledWith({ rows: { tab: 'pages', rows: [ONE, TWO] }, total: 2, meta: META }),
    );
    // Never rows of a scope that is still being read
    expect(register.mock.calls[0]?.[0]).toBeNull();
    unmount();
    expect(register).toHaveBeenLastCalledWith(null);
  });

  it('keeps the table at least 20rem high and lets the tab scroll instead of squeezing it', async () => {
    renderTab();
    const table = await loaded();
    const held = table.closest('.min-h-80');
    expect(held).not.toBeNull();
    expect(held?.parentElement).toHaveClass('lg:overflow-y-auto');
    expect(held).toHaveClass('h-96', 'lg:h-auto', 'lg:flex-1');
    // The card is above the table, inside the same scrolling body
    const card = await screen.findByRole('region', { name: 'Prompts with no own page cited' });
    expect(held?.parentElement).toContainElement(card);
  });

  it('takes the rows back from the export while another order is read, and hands over the new ones when they arrive', async () => {
    const second = gate();
    let calls = 0;
    server.use(
      http.get(PAGES, async () => {
        calls += 1;
        if (calls > 1) await second.opened;
        return HttpResponse.json(pagePage(calls === 1 ? [ONE, TWO] : [TWO]));
      }),
    );
    const register = vi.fn();
    const { user } = renderTab('', {}, { registerExport: register });
    await loaded();
    await waitFor(() => expect(register.mock.lastCall?.[0]).not.toBeNull());
    await user.click(screen.getByRole('combobox', { name: 'Order by' }));
    await user.click(await screen.findByRole('option', { name: 'Prompts' }));
    await waitFor(() => expect(calls).toBe(2));
    // The rows of the last order stand in on screen while the new read is held: they are not the file's rows
    await waitFor(() => expect(register.mock.lastCall?.[0]).toBeNull());
    act(() => second.open());
    await waitFor(() => expect(register.mock.lastCall?.[0]).toMatchObject({ rows: { tab: 'pages', rows: [TWO] } }));
  });

  it('hands over the rows the search leaves, of the total the scope has', async () => {
    servePages([ONE, TWO], { total: 40 });
    const register = vi.fn();
    const { user } = renderTab('', {}, { registerExport: register });
    await loaded();
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), 'hubspot');
    await waitFor(() =>
      expect(register).toHaveBeenLastCalledWith({ rows: { tab: 'pages', rows: [TWO] }, total: 40, meta: META }),
    );
  });

  it.each(['default', 'compact'])('is axe clean at %s density', async (density) => {
    const { container } = renderTab(`density=${density}`);
    await loaded();
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

describe('PagesTab and the source inspector', () => {
  type Inspect = NonNullable<CitationTabContext['inspect']>;
  /** What the page hands the tab: the open record, the way to open one, to report the order and to link. */
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

  it('a page row opens the source inspector (inspect=source:id)', async () => {
    const { inspect, open } = inspecting();
    const { user } = renderTab('', {}, { inspect });
    const table = await loaded();
    await user.click(within(table).getByText('Page 1'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ type: 'source', id: '1' }, 'inspector');
  });

  it('opens the focused row with the keyboard', async () => {
    const { inspect, open } = inspecting();
    const { user } = renderTab('', {}, { inspect });
    const table = await loaded();
    within(table).getAllByRole('rowheader')[1]?.focus();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith({ type: 'source', id: '2' }, 'inspector');
  });

  it('makes the path a link to the inspector, and a click on it does not open the row twice', async () => {
    const { inspect, open } = inspecting();
    const { user } = renderTab('', {}, { inspect });
    const table = await loaded();
    const link = within(table).getByRole('link', { name: 'g2.com/products/p1' });
    expect(link).toHaveAttribute('href', '/digibranders/fynix/ai/citations?inspect=source:1');
    // jsdom cannot follow a link to another address
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    // The link goes where it says; the row's own open is not also called
    expect(open).not.toHaveBeenCalled();
    // The page itself is one control away: Open, in a new tab
    expect(within(table).getAllByRole('link', { name: 'Open g2.com/products/p1 in a new tab' })[0]).toHaveAttribute(
      'href',
      'https://g2.com/products/p1',
    );
  });

  it('leaves the path as the outbound link when the page offers no inspector', async () => {
    renderTab();
    const table = await loaded();
    expect(within(table).queryByRole('link', { name: 'g2.com/products/p1' })).toBeNull();
    expect(within(table).getByRole('link', { name: 'Open g2.com/products/p1 in a new tab' })).toBeInTheDocument();
  });

  it('marks the open source as the current row', async () => {
    const { inspect } = inspecting({ type: 'source', id: '2' });
    renderTab('', {}, { inspect });
    const table = await loaded();
    expect(rowOf(table, 'The CRM guide')).toHaveAttribute('aria-current', 'true');
    expect(rowOf(table, 'Page 1')).not.toHaveAttribute('aria-current');
  });

  it('reports the pages in the order of the table, which J and K step through', async () => {
    const { inspect, setOrder } = inspecting();
    renderTab('', {}, { inspect });
    await loaded();
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('source', ['1', '2']));
    expect(setOrder.mock.calls.every(([type]) => type === 'source')).toBe(true);
  });

  it('reports a page read in two roles once', async () => {
    servePages([ONE, pageOf(1, { domain_role: 'competitor', role_entity_id: 'ent-rival' }), TWO]);
    const { inspect, setOrder } = inspecting();
    renderTab('', {}, { inspect });
    await loaded();
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('source', ['1', '2']));
  });

  it('reports the order the search leaves: only the listed pages are steps', async () => {
    const { inspect, setOrder } = inspecting();
    const { user } = renderTab('', {}, { inspect });
    await loaded();
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), 'hubspot');
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('source', ['2']));
  });

  it('reports nothing while another tab is the one shown', async () => {
    const { inspect, setOrder } = inspecting();
    renderWithProviders(<Harness inspect={inspect} />, { searchParams: 'tab=domains' });
    await screen.findByTestId('strip');
    expect(setOrder).not.toHaveBeenCalled();
  });
});
