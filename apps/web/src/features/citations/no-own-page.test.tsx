import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CitationRead } from './citation-reads';
import { parseScope } from './citation-scope';
import type { CitationTabContext } from './citation-tabs';
import { NoOwnPage } from './no-own-page';
import type {
  EngineCode,
  MetricCell,
  PromptOwnPagesRow,
  SourceDomainPage,
  SourceDomainRow,
  SourcesMeta,
} from '@/lib/citations/types';
import type { SourceFilters } from '@/lib/citations/source-queries';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PAIRS = mswPath(`${P}/ai/sources/prompts`);
const DOMAINS = mswPath(`${P}/ai/sources/domains`);
const PROMPT_LIST = mswPath(`${P}/prompts`);
const ENABLED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web'];
const LABELS = new Map<EngineCode, string>([
  ['chatgpt_web', 'ChatGPT'],
  ['gemini_web', 'Gemini'],
]);
const labelOf = (code: EngineCode): string => LABELS.get(code) ?? code;
const NO_ENGINES: readonly EngineCode[] = [];
const FILTERS: SourceFilters = { from: '2026-10-16', to: '2026-11-12', engines: [], roles: [], includeBranded: false };
const PAGES_SCOPE = parseScope({ tab: 'pages' }, ENABLED);
const DOMAINS_SCOPE = parseScope({ tab: 'domains' }, ENABLED);
const SOURCE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };

const id = (n: number): string => `a1b2c3d${String(n)}-0000-4000-8000-00000000000${String(n)}`;
const TEXTS = new Map([
  [id(1), 'Best CRM for startups'],
  [id(2), 'How to pick a CRM'],
]);

const META: SourcesMeta = {
  window: { from: FILTERS.from, to: FILTERS.to, timezone: 'UTC' },
  include_branded: false,
  engine_codes: [...ENABLED],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [],
};
const scopePage = (meta: SourcesMeta): SourceDomainPage => ({
  data: [],
  page: { limit: 1, offset: 0, total: 0 },
  meta,
});
const read = <TPage,>(data: TPage | undefined): CitationRead<TPage> => ({
  status: 'ready',
  data,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

const pair = (n: number, engine: EngineCode = 'chatgpt_web', answers = 4): PromptOwnPagesRow => ({
  prompt_id: id(n),
  engine_code: engine,
  answers,
  answers_citing_own: 0,
  own_citation_units: 0,
  own_pages: 0,
  top_own_page: null,
});
const pairsPage = (rows: readonly PromptOwnPagesRow[], hasMore = false): Record<string, unknown> => ({
  data: rows,
  page: { has_more: hasMore, limit: 10, next_cursor: hasMore ? 'next' : null },
  meta: { window: META.window, include_branded: false, engine_codes: [...ENABLED] },
});

const share = (units: number): MetricCell => ({
  value: units / 18420,
  numerator: units,
  denominator: 18420,
  n_observations: 4812,
});
const domainOf = (
  name: string,
  units: number,
  role: SourceDomainRow['domain_role'] = 'third_party',
): SourceDomainRow => ({
  registrable_domain: name,
  domain_role: role,
  role_entity_id: null,
  citation_units: units,
  observations: 10,
  prompts: 2,
  engines: [],
  source_share: share(units),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
});
const insteadPage = (rows: readonly SourceDomainRow[], total = rows.length): Record<string, unknown> => ({
  data: rows,
  page: { limit: 5, offset: 0, total },
  meta: META,
});
const FIVE = [
  domainOf('g2.com', 40),
  domainOf('capterra.com', 30),
  domainOf('hubspot.com', 20, 'competitor'),
  domainOf('zapier.com', 10),
  domainOf('pcmag.com', 1),
];

const promptList = (texts: ReadonlyMap<string, string> = TEXTS): Record<string, unknown> => ({
  data: [...texts].map(([promptId, text]) => ({ prompt_id: promptId, current_version: { text } })),
  page: { has_more: false, limit: 200, next_cursor: null },
});

/** Answers the three reads of the card: the pairs, the prompt texts and the domains cited instead for each prompt. */
function serve(
  rows: readonly PromptOwnPagesRow[],
  {
    hasMore = false,
    texts = TEXTS,
    instead = () => insteadPage(FIVE, 7),
  }: {
    hasMore?: boolean;
    texts?: ReadonlyMap<string, string>;
    instead?: (promptId: string) => Record<string, unknown>;
  } = {},
): void {
  server.use(
    http.get(PAIRS, () => HttpResponse.json(pairsPage(rows, hasMore))),
    http.get(PROMPT_LIST, () => HttpResponse.json(promptList(texts))),
    http.get(DOMAINS, ({ request }) =>
      HttpResponse.json(instead(new URL(request.url).searchParams.get('filter[prompt_id]') ?? '')),
    ),
  );
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

const context = (overrides: Partial<CitationTabContext> = {}): CitationTabContext => ({
  source: SOURCE,
  workspaceSlug: 'digibranders',
  projectSlug: 'fynix',
  timeZone: 'UTC',
  scope: PAGES_SCOPE,
  filters: FILTERS,
  range: { from: FILTERS.from, to: FILTERS.to },
  enabledEngines: ENABLED,
  labelOf,
  meta: read(scopePage(META)),
  previousMeta: read<SourceDomainPage>(undefined),
  setSearch: () => Promise.resolve(new URLSearchParams()),
  filterBar: { fields: [], values: {}, onClear: () => undefined },
  ...overrides,
});

const renderCard = (overrides: Partial<CitationTabContext> = {}): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(<NoOwnPage context={context(overrides)} />);

const CARD = 'Prompts with no own page cited';
const LIST = 'Prompt and engine pairs';
const card = (): Promise<HTMLElement> => screen.findByRole('region', { name: CARD });
const tableOf = async (): Promise<HTMLElement> => within(await card()).findByRole('table');
/** The table once its rows have loaded. */
async function loaded(): Promise<HTMLElement> {
  const table = await tableOf();
  await waitFor(() => expect(within(table).queryAllByRole('rowheader').length).toBeGreaterThan(0));
  return table;
}
const rowOf = (table: HTMLElement, text: string | RegExp): HTMLElement => {
  const row = within(table).getByText(text).closest('tr');
  if (row === null) throw new Error(`No row for ${String(text)}`);
  return row;
};
const idle = (client: ReturnType<typeof renderCard>['queryClient']): Promise<void> =>
  waitFor(() => expect(client.isFetching()).toBe(0));

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  serve([pair(1), pair(2, 'gemini_web', 1)]);
});
afterEach(() => {
  server.events.removeAllListeners();
});

describe('NoOwnPage', () => {
  it('says in words which prompts and engines cite no own page', async () => {
    renderCard();
    const table = await loaded();
    expect(
      within(await card()).getByRole('heading', { level: 2, name: 'Prompts with no own page cited' }),
    ).toBeInTheDocument();
    expect(within(await card()).getByText('2 prompt and engine pairs cite no page of yours.')).toBeInTheDocument();
    const first = rowOf(table, 'Best CRM for startups');
    expect(within(first).getByText('ChatGPT')).toBeInTheDocument();
    expect(within(first).getByText('none of 4 answers cites an own page')).toBeInTheDocument();
    const second = rowOf(table, 'How to pick a CRM');
    expect(within(second).getByText('Gemini')).toBeInTheDocument();
    expect(within(second).getByText('none of 1 answer cites an own page')).toBeInTheDocument();
  });

  it('asks for the first 10 pairs that cite no own page, in the scope of the page', async () => {
    const seen = watch('/ai/sources/prompts');
    renderCard({ filters: { ...FILTERS, engines: ['gemini_web'], includeBranded: true } });
    await loaded();
    const [url] = seen;
    expect(seen).toHaveLength(1);
    expect(url?.searchParams.get('filter[own_cited]')).toBe('false');
    expect(url?.searchParams.get('limit')).toBe('10');
    expect(url?.searchParams.get('from')).toBe(FILTERS.from);
    expect(url?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    expect(url?.searchParams.get('include_branded')).toBe('true');
    expect(url?.searchParams.has('cursor')).toBe(false);
  });

  it('opens up to 5 domains with their units from the count, by keyboard, and Escape closes it', async () => {
    const { user } = renderCard();
    const table = await loaded();
    const trigger = await within(rowOf(table, 'Best CRM for startups')).findByRole('button', {
      name: '7 domains cited instead for this prompt, show them',
    });
    expect(trigger).toHaveTextContent('7 cited instead');
    // In the card the scroll region is the first stop, then the trigger
    await user.tab();
    expect(screen.getByRole('region', { name: LIST })).toHaveFocus();
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    const popup = await screen.findByRole('dialog', { name: 'Cited instead' });
    expect(within(popup).getAllByRole('listitem')).toHaveLength(5);
    expect(within(popup).getByText('g2.com')).toBeInTheDocument();
    expect(within(popup).getByText('40 units')).toBeInTheDocument();
    expect(within(popup).getByText('1 unit')).toBeInTheDocument();
    expect(within(popup).getByText('and 2 more')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('reads the domains cited instead of the competitor and third party kind, for the pair of each of the first 10 rows only', async () => {
    const eleven = Array.from({ length: 11 }, (_, index) => pair(index + 1));
    serve(eleven, { hasMore: true });
    const seen = watch('/ai/sources/domains');
    const { queryClient } = renderCard();
    await loaded();
    await idle(queryClient);
    expect(seen).toHaveLength(10);
    expect(new Set(seen.map((url) => url.searchParams.get('filter[prompt_id]')))).toEqual(
      new Set(eleven.slice(0, 10).map((row) => row.prompt_id)),
    );
    for (const url of seen) {
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.getAll('filter[domain_role_in]').flatMap((value) => value.split(','))).toEqual([
        'competitor',
        'third_party',
      ]);
      expect(url.searchParams.get('filter[engine_code_in]')).toBe('chatgpt_web');
      expect(url.searchParams.get('from')).toBe(FILTERS.from);
    }
  });

  it('shows n/a, never 0, for a count whose domains are still loading, and the other rows stay', async () => {
    const held = gate();
    serve([pair(1), pair(2, 'gemini_web', 1)]);
    server.use(
      http.get(DOMAINS, async ({ request }) => {
        if (new URL(request.url).searchParams.get('filter[prompt_id]') === id(1)) await held.opened;
        return HttpResponse.json(insteadPage(FIVE, 7));
      }),
    );
    renderCard();
    const table = await loaded();
    const second = rowOf(table, 'How to pick a CRM');
    expect(await within(second).findByRole('button', { name: /7 domains cited instead/ })).toBeInTheDocument();
    const first = rowOf(table, 'Best CRM for startups');
    expect(within(first).getByText('n/a')).toBeInTheDocument();
    // The reason is text a screen reader reaches, not a tooltip on a span nothing can focus
    expect(within(first).getByText('The domains cited instead are not known yet.')).toBeInTheDocument();
    expect(within(first).queryByRole('button')).toBeNull();
    expect(within(first).queryByText('0')).toBeNull();
    act(() => held.open());
    expect(await within(first).findByRole('button', { name: /7 domains cited instead/ })).toBeInTheDocument();
  });

  it('shows n/a and a Try again for a count whose read failed, and Try again reads it again', async () => {
    serve([pair(1)], {});
    server.use(http.get(DOMAINS, () => HttpResponse.json({ code: 'internal_error' }, { status: 500 })));
    const { user } = renderCard();
    const table = await loaded();
    const row = rowOf(table, 'Best CRM for startups');
    expect(await within(row).findByText('n/a')).toBeInTheDocument();
    const retry = within(row).getByRole('button', { name: 'Try again, domains cited instead' });
    serve([pair(1)]);
    await user.click(retry);
    expect(await within(row).findByRole('button', { name: /7 domains cited instead/ })).toBeInTheDocument();
  });

  it('says a real count of 0 as 0 cited instead', async () => {
    serve([pair(1)], { instead: () => insteadPage([], 0) });
    renderCard();
    const table = await loaded();
    expect(await within(rowOf(table, 'Best CRM for startups')).findByText('0 cited instead')).toBeInTheDocument();
  });

  it('says every prompt has an own page when none is listed', async () => {
    serve([]);
    renderCard();
    expect(await screen.findByText('Every prompt has an own page cited')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says nothing when the scope has no answer: there is nothing to count', async () => {
    serve([]);
    const { queryClient } = renderCard({ meta: read(scopePage({ ...META, answers: 0, citation_units: 0 })) });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole('region', { name: CARD })).toBeNull();
  });

  it('says that more pairs are not listed, and that the count is a floor', async () => {
    serve(
      Array.from({ length: 10 }, (_, index) => pair(index + 1)),
      { hasMore: true },
    );
    renderCard();
    await loaded();
    expect(screen.getByText('10 or more prompt and engine pairs cite no page of yours.')).toBeInTheDocument();
    expect(screen.getByText('More pairs are not listed.')).toBeInTheDocument();
  });

  it('shows the id shortened and n/a for a prompt whose text is not known, as text', async () => {
    serve([pair(1), pair(3)], { texts: new Map([[id(1), '<img src=x onerror=alert(1)>']]) });
    renderCard();
    const table = await loaded();
    expect(within(table).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    // The engine mark is an image of the page's own; the hostile text is not one
    expect(table.querySelector('img[src="x"]')).toBeNull();
    expect(within(table).getByText('Prompt a1b2c3d3, text n/a')).toBeInTheDocument();
    expect(within(table).getByText('The text of this prompt could not be read.')).toBeInTheDocument();
  });

  it('keeps the list in a scroll region of bounded height that the keyboard reaches', async () => {
    renderCard();
    const table = await loaded();
    const region = within(await card()).getByRole('region', { name: LIST });
    expect(region).toContainElement(table);
    expect(region).toHaveClass('max-h-60', 'overflow-y-auto');
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('does not say every prompt has an own page while the next scope is read after an empty one', async () => {
    serve([]);
    const held = gate();
    const view = renderCard();
    expect(await screen.findByText('Every prompt has an own page cited')).toBeInTheDocument();
    server.use(
      http.get(PAIRS, async () => {
        await held.opened;
        return HttpResponse.json(pairsPage([pair(1)]));
      }),
    );
    // Another engine: a new read, whose answer is held; the empty list of the old scope stands in for it
    view.rerender(<NoOwnPage context={context({ filters: { ...FILTERS, engines: ['gemini_web'] } })} />);
    await waitFor(() => expect(screen.queryByText('Every prompt has an own page cited')).toBeNull());
    expect(await card()).toHaveAttribute('aria-busy', 'true');
    act(() => held.open());
    const table = await loaded();
    expect(within(table).getByText('Best CRM for startups')).toBeInTheDocument();
  });

  it('shows a skeleton while the pairs load, with no unknown prompt, then the rows', async () => {
    const held = gate();
    serve([pair(1)]);
    server.use(
      http.get(PAIRS, async () => {
        await held.opened;
        return HttpResponse.json(pairsPage([pair(1)]));
      }),
    );
    renderCard();
    const section = await card();
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(within(section).queryByText(/text n\/a/)).toBeNull();
    act(() => held.open());
    await loaded();
    expect(section).not.toHaveAttribute('aria-busy');
  });

  it('shows an error with Retry when the pairs cannot be read, and Retry reads them again', async () => {
    server.use(http.get(PAIRS, () => HttpResponse.json({ code: 'internal_error' }, { status: 500 })));
    const { user } = renderCard();
    expect(await screen.findByText('This list could not be loaded.')).toBeInTheDocument();
    serve([pair(1)]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const table = await loaded();
    expect(within(table).getByText('Best CRM for startups')).toBeInTheDocument();
    expect(screen.queryByText('This list could not be loaded.')).toBeNull();
  });

  it('keeps the rows and says so when a refresh fails', async () => {
    const { queryClient } = renderCard();
    await loaded();
    server.use(http.get(PAIRS, () => HttpResponse.json({ code: 'internal_error' }, { status: 500 })));
    await act(() => queryClient.invalidateQueries());
    expect(
      await screen.findByText('The list could not be refreshed. The rows shown are from the last read.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Best CRM for startups')).toBeInTheDocument();
  });

  it('reads nothing while another tab is shown', async () => {
    const seen = [watch('/ai/sources/prompts'), watch('/prompts'), watch('/ai/sources/domains')];
    const { queryClient } = renderCard({ scope: DOMAINS_SCOPE });
    await idle(queryClient);
    expect(seen.map((urls) => urls.length)).toEqual([0, 0, 0]);
    expect(screen.queryByRole('region', { name: CARD })).toBeNull();
  });

  it('reads nothing before an engine is on', async () => {
    const seen = [watch('/ai/sources/prompts'), watch('/prompts'), watch('/ai/sources/domains')];
    const { queryClient } = renderCard({ enabledEngines: NO_ENGINES });
    await idle(queryClient);
    expect(seen.map((urls) => urls.length)).toEqual([0, 0, 0]);
    expect(screen.queryByRole('region', { name: CARD })).toBeNull();
  });

  it('is axe clean', async () => {
    const { container, user } = renderCard();
    const table = await loaded();
    await within(rowOf(table, 'Best CRM for startups')).findByRole('button', { name: /cited instead/ });
    expect(await axe(container)).toHaveNoViolations();
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
