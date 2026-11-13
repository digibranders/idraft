import { act, screen, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { http, HttpResponse } from 'msw';
import { useMemo, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toFilters, useCitationScope } from './citation-scope';
import type { CitationRead } from './citation-reads';
import type { CitationTabContext } from './citation-tabs';
import { citationFilterFields } from './citations-filters';
import { DomainsTab } from './domains-tab';
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

// The canvas of the real sparkline draws nothing in jsdom: its props are what the cell decides
vi.mock('@/components/app/sparkline/sparkline-cell', () => ({
  SparklineCell: ({ label }: { label: string }): ReactElement => <span role="img" aria-label={label} />,
}));

// The address the tab builds "View all" links from
const address = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
  useSearchParams: () => new URLSearchParams(address.search),
}));

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

const domainOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1912,
  observations: 640,
  prompts: 48,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 700 },
    { engine_code: 'gemini_web', citation_units: 540 },
    { engine_code: 'google_ai_mode', citation_units: 672 },
  ],
  source_share: share(1912),
  previous: { citation_units: 1102, observations: 400 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [{ week_start: '2026-10-19', citation_units: 400, observations: 100 }],
  ...overrides,
});
const G2 = domainOf();
const HUBSPOT = domainOf({
  registrable_domain: 'hubspot.com',
  domain_role: 'competitor',
  role_entity_id: 'ent-hubspot',
  citation_units: 800,
  source_share: share(800),
});
const OWN = domainOf({
  registrable_domain: 'fynix.com',
  domain_role: 'own',
  role_entity_id: 'ent-own',
  citation_units: 4,
  source_share: share(4),
});

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
  engines: [{ engine_code: 'chatgpt_web', citation_units: 300 }],
  source_share: share(300),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [{ week_start: '2026-10-19', citation_units: 100, observations: 40 }],
  ...overrides,
});

const domainPage = (
  rows: readonly SourceDomainRow[],
  meta: SourcesMeta = META,
  total = rows.length,
): SourceDomainPage => ({
  data: [...rows],
  page: { limit: 200, offset: 0, total },
  meta,
});
const pagePage = (rows: readonly SourcePageRow[], total = rows.length): SourcePagePage => ({
  data: [...rows],
  page: { limit: 10, offset: 0, total },
  meta: META,
});

/** Every request the mock server saw for a route, as URLs. */
function watch(route: string): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(route)) seen.push(url);
  });
  return seen;
}

/** Answers the domains route with `rows`; a row below `min_support` is left out, as the API does. */
function serveDomains(
  rows: readonly SourceDomainRow[],
  { meta = META, total }: { meta?: SourcesMeta; total?: number } = {},
): void {
  server.use(
    http.get(DOMAINS, ({ request }) => {
      const min = Number(new URL(request.url).searchParams.get('min_support') ?? '1');
      const kept = rows.filter((row) => row.citation_units >= min);
      return HttpResponse.json(domainPage(kept, meta, total ?? kept.length));
    }),
  );
}
const servePages = (rows: readonly SourcePageRow[], total?: number): void =>
  server.use(http.get(PAGES, () => HttpResponse.json(pagePage(rows, total))));

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
  tab: 'domains',
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
}

/** The tab as the page gives it its context: the real scope from the address, and the strip's reads. */
function Harness({ values = {}, onClear = () => undefined, engines = ENABLED }: HarnessProps): ReactElement {
  const { scope, range, setSearch } = useCitationScope('UTC', engines);
  const filters = useMemo(() => toFilters(scope, range), [scope, range]);
  const strip = useMemo(() => read(domainPage([], META)), []);
  const previous = useMemo(() => read(domainPage([], { ...META, citation_units: 13280 })), []);
  const context: CitationTabContext = {
    source: SOURCE,
    workspaceSlug: 'digibranders',
    projectSlug: 'fynix',
    timeZone: 'UTC',
    scope,
    filters,
    range,
    enabledEngines: engines,
    labelOf,
    meta: strip,
    previousMeta: previous,
    setSearch,
    filterBar: { fields: FIELDS, values, onClear },
  };
  return (
    <>
      <p data-testid="strip">{`Strip ${String(strip.data?.meta.citation_units)}`}</p>
      <div className="flex h-96 flex-col">
        <DomainsTab context={context} />
      </div>
    </>
  );
}

function renderTab(
  searchParams = '',
  options: ProvidedRenderOptions = {},
  props: HarnessProps = {},
): ReturnType<typeof renderWithProviders> {
  address.search = searchParams;
  return renderWithProviders(<Harness {...props} />, { searchParams, ...options });
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  serveDomains([G2, HUBSPOT]);
  servePages([pageOf(1), pageOf(2)]);
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
  address.search = '';
});

const grid = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Cited domains' });
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
const rowOf = (table: HTMLElement, name: string): HTMLElement => {
  const row = within(table).getByRole('rowheader', { name }).closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
};

describe('DomainsTab', () => {
  it('lists the domains of the scope in the order the server gave', async () => {
    serveDomains([HUBSPOT, G2]);
    renderTab();
    const table = await loaded();
    expect(names(table)).toEqual([expect.stringContaining('hubspot.com'), expect.stringContaining('g2.com')]);
  });

  it('asks the server for 200 rows with the sort, the minimum and the blocks of the page', async () => {
    const seen = watch('/sources/domains');
    renderTab();
    await loaded();
    const query = seen[0]?.searchParams;
    expect(query?.get('limit')).toBe('200');
    expect(query?.get('min_support')).toBe('2');
    expect(query?.get('compare')).toBe('previous_period');
    expect(query?.get('include')).toBe('series,cited_with,by_role_by_engine');
    expect(query?.has('sort')).toBe(false);
  });

  it('a domain row expands to its top 10 pages on a click and collapses again', async () => {
    const { user } = renderTab();
    const table = await loaded();
    expect(rowOf(table, 'g2.com')).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    expect(rowOf(table, 'g2.com')).toHaveAttribute('aria-expanded', 'true');
    expect(
      await within(table).findByRole('link', { name: 'Open g2.com/products/p1 in a new tab' }),
    ).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Open g2.com/products/p2 in a new tab' })).toBeInTheDocument();
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    expect(rowOf(table, 'g2.com')).toHaveAttribute('aria-expanded', 'false');
    expect(within(table).queryByRole('link', { name: 'Open g2.com/products/p1 in a new tab' })).toBeNull();
  });

  it('names the disclosure of each row by the domain, and says Collapse once it is open', async () => {
    const { user } = renderTab();
    const table = await loaded();
    await user.click(within(table).getByRole('button', { name: 'Expand pages of g2.com' }));
    expect(await within(table).findByRole('button', { name: 'Collapse pages of g2.com' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Expand pages of hubspot.com' })).toBeInTheDocument();
  });

  it('opens and closes a row with the keyboard', async () => {
    const { user } = renderTab();
    const table = await loaded();
    within(table).getByRole('rowheader', { name: 'g2.com' }).focus();
    await user.keyboard('{Enter}');
    expect(rowOf(table, 'g2.com')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(rowOf(table, 'g2.com')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a row with Right Arrow from its first cell', async () => {
    const { user } = renderTab();
    const table = await loaded();
    within(table).getByRole('rowheader', { name: 'g2.com' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(rowOf(table, 'g2.com')).toHaveAttribute('aria-expanded', 'true');
    expect(
      await within(table).findByRole('link', { name: 'Open g2.com/products/p1 in a new tab' }),
    ).toBeInTheDocument();
  });

  it('reads the pages of a domain only while it is expanded, in its role and the scope of the page', async () => {
    const seen = watch('/sources/pages');
    const { user } = renderTab('engine=chatgpt_web&min=3');
    const table = await loaded();
    expect(seen).toHaveLength(0);
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    await within(table).findByRole('link', { name: 'Open g2.com/products/p1 in a new tab' });
    expect(seen).toHaveLength(1);
    const query = seen[0]?.searchParams;
    expect(query?.get('filter[registrable_domain]')).toBe('g2.com');
    expect(query?.get('filter[domain_role_in]')).toBe('third_party');
    expect(query?.get('filter[engine_code_in]')).toBe('chatgpt_web');
    expect(query?.get('limit')).toBe('10');
    expect(query?.get('min_support')).toBe('3');
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    await user.click(within(table).getByRole('rowheader', { name: 'hubspot.com' }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]?.searchParams.get('filter[registrable_domain]')).toBe('hubspot.com');
    expect(seen[1]?.searchParams.get('filter[domain_role_in]')).toBe('competitor');
  });

  it('shows View all 48 pages for a domain with more than 10 and links to the Pages tab filtered to it', async () => {
    servePages(
      Array.from({ length: 10 }, (_, index) => pageOf(index + 1)),
      48,
    );
    const { user } = renderTab(
      'engine=gemini_web,chatgpt_web&role=third_party&topic=t-security&branded=include&cmp=off&sort=-observations&min=3&win=7d&cols=domain,answers&density=default',
    );
    const table = await loaded();
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    const link = await within(table).findByRole('link', { name: 'View all 48 pages' });
    const href = new URL(link.getAttribute('href') ?? '', 'https://app.test');
    expect(href.pathname).toBe('/digibranders/fynix/ai/citations');
    expect(href.searchParams.get('tab')).toBe('pages');
    expect(href.searchParams.get('domain')).toBe('equals:g2.com');
    // the scope stays as it was: the engines as written, the role, the minimum, the window and the density
    expect(href.searchParams.get('engine')).toBe('gemini_web,chatgpt_web');
    expect(href.searchParams.get('role')).toBe('third_party');
    expect(href.searchParams.get('min')).toBe('3');
    expect(href.searchParams.get('win')).toBe('7d');
    expect(href.searchParams.get('density')).toBe('default');
    expect(href.searchParams.get('topic')).toBe('t-security');
    expect(href.searchParams.get('branded')).toBe('include');
    expect(href.searchParams.get('cmp')).toBe('off');
    expect(href.searchParams.get('sort')).toBe('-observations');
    // the Domains columns are not the Pages columns
    expect(href.searchParams.has('cols')).toBe(false);
  });

  it('encodes the registrable domain of the link', async () => {
    serveDomains([domainOf({ registrable_domain: 'a&b=c.example' })]);
    servePages(
      Array.from({ length: 10 }, (_, index) => pageOf(index + 1)),
      11,
    );
    const { user } = renderTab();
    const table = await loaded();
    await user.click(within(table).getByRole('rowheader', { name: 'a&b=c.example' }));
    const link = await within(table).findByRole('link', { name: 'View all 11 pages' });
    const href = new URL(link.getAttribute('href') ?? '', 'https://app.test');
    expect(href.searchParams.get('domain')).toBe('equals:a&b=c.example');
    expect([...href.searchParams.keys()].filter((key) => key === 'b')).toEqual([]);
  });

  it('a page row shows the path, the title as text and its share of the same total', async () => {
    servePages([pageOf(1, { title: '<img src=x onerror=alert(1)>' })]);
    const { user, container } = renderTab();
    const table = await loaded();
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    const link = await within(table).findByRole('link', { name: 'Open g2.com/products/p1 in a new tab' });
    const row = link.closest('tr');
    if (row === null) throw new Error('The page row is missing');
    expect(within(row).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    // 300 of 18,420 units, as the domain's share is
    expect(row).toHaveTextContent('1.6%');
  });

  it('names the page on the trend of a page row, not the domain', async () => {
    const { user } = renderTab();
    const table = await loaded();
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    await within(table).findByRole('link', { name: 'Open g2.com/products/p1 in a new tab' });
    expect(within(table).getByRole('img', { name: 'Weekly share of https://g2.com/products/p1' })).toBeInTheDocument();
    expect(within(table).getByRole('img', { name: 'Weekly share of https://g2.com/products/p2' })).toBeInTheDocument();
    expect(within(table).getByRole('img', { name: 'Weekly share of g2.com' })).toBeInTheDocument();
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

  it('shows the share by engine under one heading', async () => {
    renderTab();
    const table = await loaded();
    expect(within(table).getByRole('columnheader', { name: 'Share by engine' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Gemini' })).toBeInTheDocument();
  });

  it('asks again for the minimum chosen and leaves the strip as it was', async () => {
    const seen = watch('/sources/domains');
    serveDomains([G2, HUBSPOT, OWN]);
    const updates: string[] = [];
    const { user } = renderTab('', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    const table = await loaded();
    // the default minimum, 2, leaves the 4 unit row in; 10 leaves it out
    expect(names(table)).toHaveLength(3);
    await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
    await user.click(await screen.findByRole('option', { name: 'At least 10 units' }));
    await waitFor(() => expect(names(table)).toHaveLength(2));
    expect(seen.at(-1)?.searchParams.get('min_support')).toBe('10');
    expect(updates.at(-1)).toContain('min=10');
    expect(screen.getByTestId('strip')).toHaveTextContent('Strip 18420');
    expect(seen.every((url) => url.searchParams.get('limit') === '200')).toBe(true);
  });

  it('writes no min for the default', async () => {
    const updates: string[] = [];
    const { user } = renderTab('min=5', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    await loaded();
    await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
    await user.click(await screen.findByRole('option', { name: 'At least 2 units' }));
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(updates.at(-1)).not.toContain('min=');
  });

  it('the sort select writes sort and asks the server, and drops it for the default', async () => {
    const seen = watch('/sources/domains');
    const updates: string[] = [];
    const { user } = renderTab('', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    await loaded();
    const select = screen.getByRole('combobox', { name: 'Order by' });
    expect(select).toHaveTextContent('Citation units');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Answers' }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('sort')).toBe('-observations'));
    expect(updates.at(-1)).toContain('sort=-observations');
    await user.click(screen.getByRole('combobox', { name: 'Order by' }));
    await user.click(await screen.findByRole('option', { name: 'Citation units' }));
    await waitFor(() => expect(updates.at(-1)).not.toContain('sort='));
  });

  it('says the shares and the units they are of, above the table', async () => {
    renderTab();
    await loaded();
    // The Share header says it too, in its tooltip: the line is the paragraph above the table
    const lines = screen.getAllByText('Shares are of 18,420 citation units in 4,812 answers.');
    expect(lines.some((line) => line.tagName === 'P')).toBe(true);
  });

  it('says the 200 most cited domains are listed of N above 200', async () => {
    serveDomains([G2, HUBSPOT], { total: 1204 });
    renderTab();
    await loaded();
    expect(
      screen.getByText('The 2 most cited domains are listed of 1,204. Raise the minimum or narrow the filters.'),
    ).toBeInTheDocument();
  });

  it('says nothing when every domain is listed', async () => {
    renderTab();
    await loaded();
    expect(screen.queryByText(/most cited domains are listed of/)).toBeNull();
  });

  it('says nothing is marked New when the previous period has no answers', async () => {
    serveDomains([G2, HUBSPOT], { meta: { ...META, previous_answers: 0 } });
    renderTab();
    await loaded();
    expect(screen.getByText('The previous period has no answers, so nothing is marked New.')).toBeInTheDocument();
  });

  it('says nothing of the previous period when it had answers', async () => {
    renderTab();
    await loaded();
    expect(screen.queryByText(/previous period has no answers/)).toBeNull();
  });

  it('says nothing of the previous period when the comparison is off', async () => {
    serveDomains([G2, HUBSPOT], { meta: { ...META, previous_answers: 0 } });
    renderTab('cmp=off');
    await loaded();
    expect(screen.queryByText(/previous period has no answers/)).toBeNull();
  });

  it('filtered to nothing says why, names the filters and offers Clear filters', async () => {
    serveDomains([]);
    const onClear = vi.fn();
    const { user } = renderTab('', {}, { values: { role: { kind: 'enum', values: ['own'] } }, onClear });
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.getByText('Role: Own')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('a filter that leaves no answer is not "No citations yet": it names the filter and offers Clear filters', async () => {
    serveDomains([], { meta: { ...META, answers: 0, answers_citing: 0, citation_units: 0, by_role: [] } });
    const onClear = vi.fn();
    const { user } = renderTab('', {}, { values: { topic: { kind: 'enum', values: ['t-security'] } }, onClear });
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No citations yet' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'The answers cite no source' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('a minimum that leaves no row says so and Clear filters puts it back to the default', async () => {
    // 800 units: above the default minimum, below 1,000
    serveDomains([HUBSPOT]);
    const updates: string[] = [];
    const { user } = renderTab('min=1000', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.getByText('Lower the fewest citation units to see more rows.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(updates.at(-1)).not.toContain('min=');
    expect((await loaded()).querySelectorAll('[role="rowheader"]').length).toBeGreaterThan(0);
  });

  it('says nothing of the minimum when the default leaves no row because nothing was cited', async () => {
    serveDomains([], { meta: { ...META, answers: 12, answers_citing: 0, citation_units: 0, by_role: [] } });
    renderTab();
    expect(await screen.findByRole('heading', { name: 'The answers cite no source' })).toBeInTheDocument();
    expect(screen.queryByText('Lower the fewest citation units to see more rows.')).toBeNull();
  });

  it('says there are no citations yet, with a way to the prompts, when no answer was read', async () => {
    serveDomains([], { meta: { ...META, answers: 0, answers_citing: 0, citation_units: 0, by_role: [] } });
    renderTab();
    expect(await screen.findByRole('heading', { name: 'No citations yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Topics and Prompts' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/prompts',
    );
  });

  it('says the answers cite no source when answers were read and none names one', async () => {
    serveDomains([], { meta: { ...META, answers: 12, answers_citing: 0, citation_units: 0, by_role: [] } });
    renderTab();
    expect(await screen.findByRole('heading', { name: 'The answers cite no source' })).toBeInTheDocument();
    expect(screen.getByText('12 answers were read in this window and none names a source.')).toBeInTheDocument();
  });

  it('finds a listed domain by its name and says so when none matches', async () => {
    const { user } = renderTab();
    const table = await loaded();
    const search = screen.getByRole('searchbox', { name: 'Search in table' });
    expect(search).toHaveAttribute('placeholder', 'Search listed domains');
    await user.type(search, 'hub');
    await waitFor(() => expect(names(table)).toEqual([expect.stringContaining('hubspot.com')]));
    await user.clear(search);
    await user.type(search, 'nothing');
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
  });

  it('shows skeleton rows while loading and keeps the rows while it reads again', async () => {
    const first = gate();
    const second = gate();
    let calls = 0;
    server.use(
      http.get(DOMAINS, async ({ request }) => {
        calls += 1;
        await (calls === 1 ? first.opened : second.opened);
        const min = Number(new URL(request.url).searchParams.get('min_support') ?? '1');
        return HttpResponse.json(domainPage([G2, HUBSPOT].filter((row) => row.citation_units >= min)));
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
      http.get(DOMAINS, ({ request }) => {
        calls += 1;
        if (calls === 1) return problem(request, 'not_found');
        return HttpResponse.json(domainPage([G2, HUBSPOT]));
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
      http.get(DOMAINS, ({ request }) => {
        calls += 1;
        if (calls === 2) return problem(request, 'not_found');
        return HttpResponse.json(domainPage([G2, HUBSPOT]));
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

  it('a failed child read shows the failure in its row with Retry, and the rest stays', async () => {
    let failing = true;
    server.use(
      http.get(PAGES, ({ request }) =>
        failing ? problem(request, 'not_found') : HttpResponse.json(pagePage([pageOf(1)])),
      ),
    );
    const { user } = renderTab();
    const table = await loaded();
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    expect(await within(table).findByText('The pages of this domain could not be loaded.')).toBeInTheDocument();
    expect(names(table).some((name) => name.includes('hubspot.com'))).toBe(true);
    failing = false;
    await user.click(within(table).getByRole('button', { name: 'Retry' }));
    expect(
      await within(table).findByRole('link', { name: 'Open g2.com/products/p1 in a new tab' }),
    ).toBeInTheDocument();
    expect(within(table).queryByText('The pages of this domain could not be loaded.')).toBeNull();
  });

  it('the own row is tinted and says Own in words', async () => {
    serveDomains([OWN, G2]);
    renderTab();
    const table = await loaded();
    const own = rowOf(table, 'fynix.com');
    expect(own).toHaveAttribute('data-tone', 'own');
    expect(within(own).getByText('Own')).toBeInTheDocument();
    expect(rowOf(table, 'g2.com')).not.toHaveAttribute('data-tone');
  });

  /** Nothing in flight, so a read that was going to start has started: the log then says whether it did. */
  const idle = (client: ReturnType<typeof renderTab>['queryClient']): Promise<void> =>
    waitFor(() => expect(client.isFetching()).toBe(0));

  it('reads nothing while another tab is the one shown', async () => {
    const seen = watch('/sources/domains');
    const { queryClient } = renderTab('tab=pages');
    await idle(queryClient);
    expect(seen).toHaveLength(0);
  });

  it('reads nothing while the engines are not known: an empty list would mean every engine', async () => {
    const domains = watch('/sources/domains');
    const { queryClient } = renderTab('engine=chatgpt_web', {}, { engines: NO_ENGINES });
    await idle(queryClient);
    expect(domains).toHaveLength(0);
    expect(screen.queryByRole('treegrid', { name: 'Cited domains' })?.getAttribute('aria-busy')).toBe('true');
  });

  it.each(['default', 'compact'])('is axe clean at %s density', async (density) => {
    const { container, user } = renderTab(`density=${density}`);
    const table = await loaded();
    await user.click(within(table).getByRole('rowheader', { name: 'g2.com' }));
    await within(table).findByRole('link', { name: 'Open g2.com/products/p1 in a new tab' });
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
