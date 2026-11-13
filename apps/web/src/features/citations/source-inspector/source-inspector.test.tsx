import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SourceInspector, type SourceInspectorProps } from './source-inspector';
import { HOSTILE_TITLES, HOSTILE_URLS, MARKER } from '@/components/app/cells/xss-fixtures';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { readChartTokens } from '@/lib/design/read-tokens';
import type {
  CitationPage,
  CitationRow,
  EngineCode,
  EngineRoleUnits,
  SourceDomainPage,
  SourcePagePage,
  SourcePageRow,
  SourceScope,
  SourcesMeta,
} from '@/lib/citations/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the option the frame gives the chart is what these tests read
const drawn = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option }: { option: (tokens: ChartTokens) => Record<string, unknown> }) => {
    drawn.options.push(option(readChartTokens()));
    return <div data-testid="echart-canvas" />;
  },
}));

/** Thursday 12 November 2026, noon UTC. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai';
const CITATIONS = mswPath(`${P}/citations`);
const PAGES = mswPath(`${P}/sources/pages`);
const DOMAINS = mswPath(`${P}/sources/domains`);
const SOURCE: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: 'p-fynix' };
const FILTERS = { from: '2026-10-16', to: '2026-11-12' };
const ENGINES: readonly { code: EngineCode; label: string }[] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
  { code: 'google_ai_mode', label: 'AI Mode' },
];
const URL_ID = 7;
const PAGE_URL = 'https://g2.com/products/crm';

const share = (units: number, total = 18420): SourcePageRow['source_share'] => ({
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
  engine_codes: ['chatgpt_web', 'gemini_web', 'google_ai_mode'],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [{ domain_role: 'third_party', citation_units: 18420, observations: 4000 }],
  by_role_by_engine: [block('chatgpt_web', 7000), block('gemini_web', 6000), block('google_ai_mode', 5420)],
  series: [
    { week_start: '2026-10-12', answers: 0, citation_units: 0, distinct_domains: 0 },
    { week_start: '2026-10-19', answers: 1200, citation_units: 4000, distinct_domains: 300 },
    { week_start: '2026-10-26', answers: 1200, citation_units: 5000, distinct_domains: 300 },
  ],
};

const pageOf = (overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: URL_ID,
  url: PAGE_URL,
  title: 'Best CRM software',
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 300,
  observations: 120,
  prompts: 20,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 200 },
    { engine_code: 'gemini_web', citation_units: 100 },
    { engine_code: 'google_ai_mode', citation_units: 0 },
  ],
  source_share: share(300),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [
    { week_start: '2026-10-12', citation_units: 0, observations: 0 },
    { week_start: '2026-10-19', citation_units: 120, observations: 60 },
    { week_start: '2026-10-26', citation_units: 0, observations: 0 },
  ],
  ...overrides,
});

const citationOf = (overrides: Partial<CitationRow> = {}): CitationRow => ({
  citation_index: 2,
  citation_kind: 'link',
  domain_role: 'third_party',
  engine_code: 'chatgpt_web',
  host: 'g2.com',
  observation_id: '1001',
  observed_at: '2026-11-10T08:00:00Z',
  occurrences: 1,
  prompt_id: '0c1f4e7b-0000-4000-8000-000000000001',
  raw_url: PAGE_URL,
  registrable_domain: 'g2.com',
  role_entity_id: null,
  title: 'Best CRM software',
  url: PAGE_URL,
  url_id: URL_ID,
  ...overrides,
});

const citationPage = (rows: readonly CitationRow[]): CitationPage => ({
  data: [...rows],
  page: { has_more: false, limit: 100, next_cursor: null },
});
const pagePage = (rows: readonly SourcePageRow[], meta: SourcesMeta = META): SourcePagePage => ({
  data: [...rows],
  page: { limit: 200, offset: 0, total: rows.length },
  meta,
});
const scopePage = (meta: SourcesMeta = META): SourceDomainPage => ({
  data: [],
  page: { limit: 1, offset: 0, total: 0 },
  meta,
});

interface World {
  citations?: readonly CitationRow[];
  pages?: readonly SourcePageRow[];
  meta?: SourcesMeta;
}
/** The three reads of the inspector, answered from a fixed world. */
const serve = ({ citations = [citationOf()], pages = [pageOf()], meta = META }: World = {}): void => {
  server.use(
    http.get(CITATIONS, () => HttpResponse.json(citationPage(citations))),
    http.get(PAGES, () => HttpResponse.json(pagePage(pages, meta))),
    http.get(DOMAINS, () => HttpResponse.json(scopePage(meta))),
  );
};

function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

const onClose = vi.fn();
const onStep = vi.fn();
const onTabChange = vi.fn();

function Harness(props: Partial<SourceInspectorProps> = {}): ReactElement {
  return (
    <InspectorLayout
      inspector={
        <SourceInspector
          source={SOURCE}
          filters={FILTERS}
          sourceId={String(URL_ID)}
          timeZone="UTC"
          engines={ENGINES}
          domainHref={(registrable) => `/digibranders/fynix/ai/citations?inspect=domain%3A${registrable}` as Route}
          positionText="3 of 12"
          navigation={{
            onPrevious: () => onStep('previous'),
            onNext: () => onStep('next'),
            atFirst: false,
            atLast: false,
          }}
          onStep={onStep}
          tab="overview"
          onTabChange={onTabChange}
          onClose={onClose}
          {...props}
        />
      }
    >
      <p>The list</p>
    </InspectorLayout>
  );
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  drawn.options.length = 0;
  onClose.mockReset();
  onStep.mockReset();
  onTabChange.mockReset();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  serve();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
  server.events.removeAllListeners();
  Reflect.deleteProperty(window, MARKER);
});

const panel = (name = 'Best CRM software'): Promise<HTMLElement> => screen.findByRole('complementary', { name });
const strip = (): Promise<HTMLElement> => screen.findByRole('group', { name: 'Source summary' });
const engineTable = (): Promise<HTMLElement> =>
  screen.findByRole('table', { name: 'Citations of this page by engine' });
/** The open tooltip: the popup a hover or focus opens. */
const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');
const lastOption = (): Record<string, unknown> => drawn.options.at(-1) ?? {};

describe('the source inspector header', () => {
  it('shows the title, the host, the role, Category n/a, and when it was first and last cited', async () => {
    renderWithProviders(<Harness />);
    const inspector = await panel();
    expect(within(inspector).getByRole('heading', { level: 2, name: 'Best CRM software' })).toBeInTheDocument();
    expect(within(inspector).getByText('g2.com')).toBeInTheDocument();
    expect(within(inspector).getByText('Third party')).toBeInTheDocument();
    expect(within(inspector).getByText('Category n/a')).toBeInTheDocument();
    expect(within(inspector).getByText('Source')).toBeInTheDocument();
    expect(within(inspector).getByText('3 of 12')).toBeInTheDocument();
    // The newest citation: 10 November, 08:00 UTC, 52 hours before NOW
    expect(within(inspector).getByText('Last cited 2d ago')).toBeInTheDocument();
    expect(await within(inspector).findByText('First cited Oct 20')).toBeInTheDocument();
  });

  it('names the page by its path when no answer gave it a title', async () => {
    serve({ citations: [citationOf({ title: null })], pages: [pageOf({ title: null })] });
    renderWithProviders(<Harness />);
    expect(await screen.findByRole('heading', { level: 2, name: '/products/crm' })).toBeInTheDocument();
  });

  it('names a page with no address anyone can read Untitled page', async () => {
    serve({ citations: [citationOf({ title: null, url: 'not an address' })] });
    renderWithProviders(<Harness />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Untitled page' })).toBeInTheDocument();
  });

  it('shows a title as text, never as markup', async () => {
    const hostile = HOSTILE_TITLES[0] ?? '';
    serve({ citations: [citationOf({ title: hostile })], pages: [pageOf({ title: hostile })] });
    const { container } = renderWithProviders(<Harness />);
    const inspector = await panel(hostile);
    expect(within(inspector).getByRole('heading', { level: 2 })).toHaveTextContent(hostile);
    await strip();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>)[MARKER]).toBeUndefined();
  });

  it('names the inspector by the page, and the source by its id until the page is known', async () => {
    const held = gate();
    server.use(
      http.get(CITATIONS, async () => {
        await held.opened;
        return HttpResponse.json(citationPage([citationOf()]));
      }),
    );
    renderWithProviders(<Harness />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Source 7' })).toBeInTheDocument();
    held.open();
    expect(await screen.findByRole('heading', { level: 2, name: 'Best CRM software' })).toBeInTheDocument();
  });
});

describe('the More menu', () => {
  const open = async (): Promise<ReturnType<typeof renderWithProviders>> => {
    const view = renderWithProviders(<Harness />);
    const inspector = await panel();
    await view.user.click(within(inspector).getByRole('button', { name: 'More actions for Best CRM software' }));
    return view;
  };

  it('has Copy link, Copy address, Open the page and Open domain', async () => {
    await open();
    expect(await screen.findByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy address' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open the page' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open domain' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/ai/citations?inspect=domain%3Ag2.com',
    );
  });

  it('opens the page in a new tab that cannot reach back', async () => {
    await open();
    const item = await screen.findByRole('menuitem', { name: 'Open the page' });
    expect(item).toHaveAttribute('href', PAGE_URL);
    expect(item).toHaveAttribute('target', '_blank');
    expect(item.getAttribute('rel')).toContain('noopener');
    expect(item.getAttribute('rel')).toContain('noreferrer');
  });

  it.each(HOSTILE_URLS.filter((entry) => !entry.linkable))(
    'offers no Open the page for an address that is not a web address ($name)',
    async ({ url }) => {
      serve({ citations: [citationOf({ url })] });
      const view = renderWithProviders(<Harness />);
      const inspector = await panel();
      await view.user.click(within(inspector).getByRole('button', { name: 'More actions for Best CRM software' }));
      await screen.findByRole('menuitem', { name: 'Copy link' });
      expect(screen.queryByRole('menuitem', { name: 'Open the page' })).toBeNull();
      // Copying the address is still there: it is text, and the person decides what to do with it
      expect(screen.getByRole('menuitem', { name: 'Copy address' })).toBeInTheDocument();
    },
  );
});

describe('the source inspector strip', () => {
  it('shows the units, the share with its count, the answers, the prompts and the engines', async () => {
    const { container } = renderWithProviders(<Harness />);
    const summary = await strip();
    expect(await within(summary).findByText('300')).toBeInTheDocument();
    expect(within(summary).getByText('Citation units')).toBeInTheDocument();
    expect(within(summary).getByText('of 18,420 units in 4,812 answers, all engines')).toBeInTheDocument();
    expect(within(summary).getByText('1.6%')).toBeInTheDocument();
    expect(within(summary).getByText('300 of 18,420 units, all engines')).toBeInTheDocument();
    expect(within(summary).getByText('Answers citing it')).toBeInTheDocument();
    expect(within(summary).getByText('120')).toBeInTheDocument();
    expect(within(summary).getByText('of 4,812 answers')).toBeInTheDocument();
    expect(within(summary).getByText('20')).toBeInTheDocument();
    expect(within(summary).getByText('whose answers cite it')).toBeInTheDocument();
    expect(within(summary).getByText('Engines')).toBeInTheDocument();
    expect(within(summary).getByText('2')).toBeInTheDocument();
    expect(within(summary).getByText('2 of 3 engines')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('names the chosen engines in the units and the share context', async () => {
    renderWithProviders(
      <Harness filters={{ ...FILTERS, engines: ['chatgpt_web', 'gemini_web'] }} engines={ENGINES.slice(0, 2)} />,
    );
    const summary = await strip();
    expect(
      await within(summary).findByText('of 18,420 units in 4,812 answers, ChatGPT and Gemini'),
    ).toBeInTheDocument();
    expect(within(summary).getByText('300 of 18,420 units, ChatGPT and Gemini')).toBeInTheDocument();
    expect(within(summary).queryByText(/all engines/)).toBeNull();
  });

  it('shows no change figure: the read has no period before it, so a zero would be a lie', async () => {
    renderWithProviders(<Harness />);
    const summary = await strip();
    await within(summary).findByText('300');
    expect(within(summary).queryByText(/vs |change|\+/i)).toBeNull();
  });
});

describe('the trend', () => {
  it('draws one line labelled All engines, with the counts in the meta line and the table', async () => {
    const { user } = renderWithProviders(<Harness />);
    await screen.findByTestId('echart-canvas');
    expect(screen.getByRole('heading', { level: 3, name: 'Citation trend' })).toBeInTheDocument();
    expect(screen.getByText('All engines, weekly, Oct 16 to Nov 12, 2026')).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: 'Citation trend' });
    expect(document.getElementById(chart.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'Weekly share of all citation units that cite this page, all engines together.',
    );
    const lines = (lastOption().series as { name: string; data: (number | null)[] }[]).filter(
      (entry) => entry.name !== undefined,
    );
    // One pooled line, named as such, and a gap for the week in which the scope had no unit
    expect(lines.map((line) => line.name)).toEqual(['All engines']);
    expect(lines[0]?.data).toEqual([null, 0.03, 0]);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Citation trend' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Week of', 'All engines']);
    expect(within(table).getByText('3.0%, 120 of 4,000 units')).toBeInTheDocument();
    // A week with units in scope and none for the page is a real 0%, with its count
    expect(within(table).getByText('0.0%, 0 of 5,000 units')).toBeInTheDocument();
    expect(within(table).getAllByText('No data')).toHaveLength(1);
  });

  it('says every point with its count in the tooltip', async () => {
    renderWithProviders(<Harness />);
    await screen.findByTestId('echart-canvas');
    const { tooltip: tip } = lastOption() as { tooltip: { formatter: (params: unknown[]) => string } };
    const text = tip.formatter([{ dataIndex: 1, axisValueLabel: 'Oct 19' }]);
    expect(text).toContain('Oct 19');
    expect(text).toContain('All engines');
    expect(text).toContain('3.0%, 120 of 4,000 units');
    // The week the scope had no unit has no figure, so no 0% is claimed
    expect(tip.formatter([{ dataIndex: 0, axisValueLabel: 'Oct 12' }])).not.toContain('%');
  });

  it('says there are no weekly figures when the scope cites nothing in any week', async () => {
    serve({
      meta: {
        ...META,
        series: [{ week_start: '2026-10-19', answers: 10, citation_units: 0, distinct_domains: 0 }],
      },
    });
    renderWithProviders(<Harness />);
    expect(await screen.findByText('No weekly figures')).toBeInTheDocument();
    expect(screen.getByText('No answer in this window cites any source.')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).toBeNull();
  });
});

describe('the engine table', () => {
  it('says each share with its count, the engines apart and never added up', async () => {
    renderWithProviders(<Harness />);
    const table = await engineTable();
    const row = (name: string): HTMLElement => {
      const found = within(table).getByRole('rowheader', { name }).closest('tr');
      if (found === null) throw new Error(`No row for ${name}`);
      return found;
    };
    expect(within(row('ChatGPT')).getByText('2.9%')).toBeInTheDocument();
    expect(within(row('ChatGPT')).getByText('200')).toBeInTheDocument();
    expect(within(row('ChatGPT')).getByText('200 of 7,000 units on ChatGPT')).toBeInTheDocument();
    expect(within(row('Gemini')).getByText('1.7%')).toBeInTheDocument();
    expect(within(row('Gemini')).getByText('100 of 6,000 units on Gemini')).toBeInTheDocument();
    // An engine that does not cite the page is a real 0 of that engine's units
    expect(within(row('AI Mode')).getByText('0')).toBeInTheDocument();
    expect(within(row('AI Mode')).getByText('0 of 5,420 units on AI Mode')).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Engine', 'Units', 'Share of the engine']);
    expect(table.querySelector('tfoot')).toBeNull();
  });

  it('says n/a with the reason, not 0%, for an engine with no unit in scope', async () => {
    const empty: SourcesMeta = {
      ...META,
      by_role_by_engine: [block('chatgpt_web', 7000), block('gemini_web', 6000), block('google_ai_mode', 0)],
    };
    serve({ meta: empty });
    const { user } = renderWithProviders(<Harness />);
    const table = await engineTable();
    const mode = within(table).getByRole('rowheader', { name: 'AI Mode' }).closest('tr');
    if (mode === null) throw new Error('The AI Mode row is missing');
    expect(within(mode).queryByText(/%/)).toBeNull();
    await user.hover(within(mode).getByText('n/a'));
    await waitFor(() => expect(tooltip()).toHaveTextContent('AI Mode does not cite this page in this window.'));
  });

  it('says the citations of an engine are not known while the totals are not read', async () => {
    serve({ meta: { ...META, by_role_by_engine: null } });
    const { user } = renderWithProviders(<Harness />);
    const table = await engineTable();
    const gemini = within(table).getByRole('rowheader', { name: 'Gemini' }).closest('tr');
    if (gemini === null) throw new Error('The Gemini row is missing');
    expect(within(gemini).queryByText(/%/)).toBeNull();
    // The units are the page's own, so they stay; only the share waits for the engine's units
    expect(within(gemini).getByText('100')).toBeInTheDocument();
    await user.hover(within(gemini).getByText('n/a'));
    await waitFor(() => expect(tooltip()).toHaveTextContent('The citations on Gemini are not known yet.'));
  });
});

describe('the source inspector states', () => {
  it('shows the strip as bars and skeletons while it loads, with the header in place', async () => {
    const held = gate();
    server.use(
      http.get(PAGES, async () => {
        await held.opened;
        return HttpResponse.json(pagePage([pageOf()]));
      }),
    );
    renderWithProviders(<Harness />);
    const inspector = await panel();
    const summary = await strip();
    expect(summary).toHaveAttribute('aria-busy', 'true');
    expect(within(summary).getByText('Citation units')).toBeInTheDocument();
    expect(within(summary).queryByText('300')).toBeNull();
    expect(within(summary).queryByText('0')).toBeNull();
    expect(
      within(inspector).getByRole('heading', { level: 3, name: 'Citation trend' }).closest('section'),
    ).toHaveAttribute('aria-busy', 'true');
    held.open();
    expect(await within(summary).findByText('300')).toBeInTheDocument();
    expect(summary).not.toHaveAttribute('aria-busy');
  });

  it('shows an inline error with Retry for the citations, keeps the header and reads again', async () => {
    let calls = 0;
    server.use(
      http.get(CITATIONS, ({ request }) => {
        calls += 1;
        return calls === 1 ? problem(request, 'internal_error') : HttpResponse.json(citationPage([citationOf()]));
      }),
    );
    const { user } = renderWithProviders(<Harness />);
    const inspector = await screen.findByRole('complementary', { name: 'Source 7' });
    expect(await within(inspector).findByText('This source could not be loaded.')).toBeInTheDocument();
    expect(within(inspector).getByRole('heading', { level: 2, name: 'Source 7' })).toBeInTheDocument();
    expect(within(inspector).queryByRole('group', { name: 'Source summary' })).toBeNull();
    await user.click(within(inspector).getByRole('button', { name: 'Try again' }));
    expect(await within(inspector).findByText('300')).toBeInTheDocument();
    expect(within(inspector).queryByText('This source could not be loaded.')).toBeNull();
  });

  it('says a page nothing cites is not cited, and draws no figure and no zero', async () => {
    serve({ citations: [] });
    renderWithProviders(<Harness />);
    const inspector = await screen.findByRole('complementary', { name: 'Source 7' });
    expect(await within(inspector).findByText('Not cited in this window')).toBeInTheDocument();
    expect(
      within(inspector).getByText(
        'No answer read in this window cites this page. Choose a longer window or another engine.',
      ),
    ).toBeInTheDocument();
    expect(within(inspector).queryByRole('group', { name: 'Source summary' })).toBeNull();
    expect(within(inspector).queryByRole('table')).toBeNull();
    expect(within(inspector).queryByText('0')).toBeNull();
    expect(within(inspector).queryByText('Category n/a')).toBeNull();
  });

  it('says n/a with the reason when the page is not among the 200 most cited pages of its domain', async () => {
    serve({ pages: [pageOf({ url_id: 99 })] });
    const { user } = renderWithProviders(<Harness />);
    const summary = await strip();
    await waitFor(() => expect(summary).not.toHaveAttribute('aria-busy'));
    expect(within(summary).getAllByText('n/a')).toHaveLength(5);
    expect(within(summary).queryByText('300')).toBeNull();
    // The header still knows who the page is: it comes from the citations
    expect(screen.getByRole('heading', { level: 2, name: 'Best CRM software' })).toBeInTheDocument();
    expect(screen.getAllByText('Totals not known')).toHaveLength(2);
    for (const name of ['Citation trend', 'Engines citing it']) {
      expect(screen.getByRole('heading', { level: 3, name }).closest('section')).toHaveTextContent(
        'This page is not among the 200 most cited pages of its domain, so its totals are not known.',
      );
    }
    expect(screen.queryByTestId('echart-canvas')).toBeNull();
    expect(screen.queryByRole('table', { name: 'Citations of this page by engine' })).toBeNull();
    await user.hover(within(summary).getAllByText('n/a')[0] ?? summary);
    await waitFor(() => expect(tooltip()).toHaveTextContent('This page is not among the 200 most cited pages'));
  });

  it('keeps the header and names what failed when the pages cannot be read, and Retry reads them again', async () => {
    let calls = 0;
    server.use(
      http.get(PAGES, ({ request }) => {
        calls += 1;
        return calls === 1 ? problem(request, 'internal_error') : HttpResponse.json(pagePage([pageOf()]));
      }),
    );
    const { user } = renderWithProviders(<Harness />);
    const inspector = await panel();
    for (const name of ['Citation trend', 'Engines citing it']) {
      const section = (await within(inspector).findByRole('heading', { level: 3, name })).closest('section');
      expect(section).toHaveTextContent('The totals of this page could not be loaded.');
    }
    expect(within(inspector).getByRole('heading', { level: 2, name: 'Best CRM software' })).toBeInTheDocument();
    expect(within(inspector).getAllByText('n/a')).toHaveLength(5);
    const [retry] = within(inspector).getAllByRole('button', { name: 'Try again' });
    if (retry === undefined) throw new Error('Retry is missing');
    await user.click(retry);
    expect(await within(inspector).findByText('300')).toBeInTheDocument();
    expect(within(inspector).queryByText('The totals of this page could not be loaded.')).toBeNull();
  });

  it('says a page the API refuses is not there, with no Retry', async () => {
    renderWithProviders(<Harness sourceId="not-a-number" />);
    const inspector = await screen.findByRole('complementary', { name: 'Source not-a-number' });
    expect(
      await within(inspector).findByText('This source does not exist or you do not have access to it.'),
    ).toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('keeps the figures at full strength and marks them busy while another window is read', async () => {
    const held = gate();
    let calls = 0;
    server.use(
      http.get(CITATIONS, async () => {
        calls += 1;
        if (calls > 1) await held.opened;
        return HttpResponse.json(citationPage([citationOf()]));
      }),
    );
    const view = renderWithProviders(<Harness />);
    const summary = await strip();
    await within(summary).findByText('300');
    view.rerender(<Harness filters={{ from: '2026-10-01', to: '2026-10-28' }} />);
    await waitFor(() => expect(calls).toBe(2));
    expect(within(await strip()).getByText('300')).toBeInTheDocument();
    expect(await strip()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Best CRM software' })).toBeInTheDocument();
    held.open();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Source summary' })).not.toHaveAttribute('aria-busy'));
  });

  it('does not show the last source under the name of the next one while it reads', async () => {
    const held = gate();
    server.use(
      http.get(CITATIONS, async ({ request }) => {
        const wanted = new URL(request.url).searchParams.get('filter[url_id]');
        if (wanted === '8') await held.opened;
        return HttpResponse.json(citationPage([citationOf()]));
      }),
    );
    const view = renderWithProviders(<Harness />);
    await within(await strip()).findByText('300');
    view.rerender(<Harness sourceId="8" />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Source 8' })).toBeInTheDocument();
    expect(within(await strip()).queryByText('300')).toBeNull();
    expect(screen.queryByText('Best CRM software')).toBeNull();
    held.open();
  });
});

describe('the tabs', () => {
  it('lists Overview now, and a tab the address asks for that is not built yet shows the Overview', async () => {
    renderWithProviders(<Harness tab="prompts" />);
    const inspector = await panel();
    const tabs = within(inspector).getByRole('tablist', { name: 'Source views' });
    const listed = within(tabs).getAllByRole('tab');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toHaveAccessibleName('Overview');
    await screen.findByTestId('echart-canvas');
    expect(within(inspector).getByRole('heading', { level: 3, name: 'Citation trend' })).toBeInTheDocument();
  });

  it('is axe clean with the chart table open', async () => {
    const { container, user } = renderWithProviders(<Harness />);
    await screen.findByTestId('echart-canvas');
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
