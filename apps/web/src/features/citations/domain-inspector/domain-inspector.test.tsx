import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainInspector, type DomainInspectorProps } from './domain-inspector';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import type { EngineCode, SourceDomainDetail, SourceDomainRow, SourcesMeta, SourceScope } from '@/lib/citations/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

/** Thursday 12 November 2026, noon UTC. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const DETAIL = mswPath(`${P}/ai/sources/domains/{registrable_domain}`);
const SOURCE: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: 'p-fynix' };
const FILTERS = { from: '2026-10-16', to: '2026-11-12' };
const PAGES_HREF = '/digibranders/fynix/ai/citations?tab=pages&domain=equals%3Ag2.com' as Route;
const ENGINES: readonly { code: EngineCode; label: string }[] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
  { code: 'google_ai_mode', label: 'AI Mode' },
];

const META: SourcesMeta = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: ['chatgpt_web', 'gemini_web', 'google_ai_mode'],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [{ domain_role: 'third_party', citation_units: 18420, observations: 4000 }],
};

const rowOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
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
  source_share: { value: 1912 / 18420, numerator: 1912, denominator: 18420, n_observations: 4812 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const weeks = (units: number, all: number): SourceDomainDetail['data']['engines'][number]['series'] => [
  { week_start: '2026-10-12', citation_units: 0, observations: 0, all_citation_units: 0, answers: 0 },
  { week_start: '2026-10-19', citation_units: units, observations: units / 2, all_citation_units: all, answers: 100 },
];
const detailOf = (overrides: Partial<SourceDomainDetail['data']> = {}): SourceDomainDetail => ({
  data: {
    registrable_domain: 'g2.com',
    rows: [rowOf()],
    engines: [
      { engine_code: 'chatgpt_web', series: weeks(700, 7000) },
      { engine_code: 'gemini_web', series: weeks(540, 6000) },
      { engine_code: 'google_ai_mode', series: weeks(672, 5420) },
    ],
    top_pages: [],
    prompts: [],
    cited_with: [],
    ...overrides,
  },
  meta: META,
});
const serve = (detail: SourceDomainDetail): void => {
  server.use(http.get(DETAIL, () => HttpResponse.json(detail)));
};
const NOT_CITED = detailOf({ rows: [], engines: [] });

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

function Harness(props: Partial<DomainInspectorProps> = {}): ReactElement {
  return (
    <InspectorLayout
      inspector={
        <DomainInspector
          source={SOURCE}
          filters={FILTERS}
          registrable="g2.com"
          timeZone="UTC"
          engines={ENGINES}
          pagesHref={PAGES_HREF}
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
  onClose.mockReset();
  onStep.mockReset();
  onTabChange.mockReset();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  serve(detailOf());
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
  server.events.removeAllListeners();
});

const panel = (): Promise<HTMLElement> => screen.findByRole('complementary', { name: 'g2.com' });
const strip = (): Promise<HTMLElement> => screen.findByRole('group', { name: 'Domain summary' });
/** The open tooltip: the popup a hover or focus opens. */
const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');
const engineTable = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Citations of g2.com by engine' });

describe('the domain inspector header', () => {
  it('shows the domain, one role badge per row, Category n/a and when it was last cited', async () => {
    serve(
      detailOf({
        rows: [
          rowOf(),
          rowOf({ domain_role: 'competitor', role_entity_id: 'ent-1', last_seen_at: '2026-11-11T08:00:00Z' }),
        ],
      }),
    );
    renderWithProviders(<Harness />);
    const inspector = await panel();
    expect(within(inspector).getByRole('heading', { level: 2, name: 'g2.com' })).toBeInTheDocument();
    expect(await within(inspector).findByText('Third party')).toBeInTheDocument();
    expect(within(inspector).getByText('Competitor')).toBeInTheDocument();
    expect(within(inspector).getByText('Category n/a')).toBeInTheDocument();
    // The newest of the rows: 11 November, 08:00 UTC, 28 hours before NOW
    expect(within(inspector).getByText('Last cited 1d ago')).toBeInTheDocument();
    expect(within(inspector).getByText('Domain')).toBeInTheDocument();
    expect(within(inspector).getByText('3 of 12')).toBeInTheDocument();
  });

  it('says why the category is n/a and why a domain has several roles', async () => {
    serve(detailOf({ rows: [rowOf(), rowOf({ domain_role: 'competitor', role_entity_id: 'ent-1' })] }));
    const { user } = renderWithProviders(<Harness />);
    const inspector = await panel();
    await user.hover(await within(inspector).findByText('Category n/a'));
    await waitFor(() => expect(tooltip()).toHaveTextContent('Categories arrive with the Sources work.'));
  });

  it('has Copy link and View pages on the Pages tab in the More menu, the second a real link', async () => {
    const { user } = renderWithProviders(<Harness />);
    const inspector = await panel();
    await user.click(within(inspector).getByRole('button', { name: 'More actions for g2.com' }));
    expect(await screen.findByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
    const pages = await screen.findByRole('menuitem', { name: 'View pages on the Pages tab' });
    expect(pages).toHaveAttribute('href', '/digibranders/fynix/ai/citations?tab=pages&domain=equals%3Ag2.com');
  });

  it('names the domain by the title and the inspector by the domain', async () => {
    renderWithProviders(<Harness registrable="G2.com" />);
    // The read is of the lower case name; the heading keeps what the address said
    expect(await screen.findByRole('heading', { level: 2, name: 'G2.com' })).toBeInTheDocument();
  });
});

describe('the domain inspector strip', () => {
  it('shows the units, the share with its count, the answers and the prompts', async () => {
    const { container } = renderWithProviders(<Harness />);
    const summary = await strip();
    expect(await within(summary).findByText('1,912')).toBeInTheDocument();
    expect(within(summary).getByText('Citation units')).toBeInTheDocument();
    expect(within(summary).getByText('of 18,420 units in 4,812 answers, all engines')).toBeInTheDocument();
    expect(within(summary).getByText('10.4%')).toBeInTheDocument();
    expect(within(summary).getByText('1,912 of 18,420 units, all engines')).toBeInTheDocument();
    expect(within(summary).getByText('Answers citing it')).toBeInTheDocument();
    expect(within(summary).getByText('640')).toBeInTheDocument();
    expect(within(summary).getByText('of 4,812 answers')).toBeInTheDocument();
    expect(within(summary).getByText('48')).toBeInTheDocument();
    expect(within(summary).getByText('whose answers cite it')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says the units and the share are of every engine when none is chosen', async () => {
    renderWithProviders(<Harness />);
    const summary = await strip();
    expect(await within(summary).findByText('of 18,420 units in 4,812 answers, all engines')).toBeInTheDocument();
    expect(within(summary).getByText('1,912 of 18,420 units, all engines')).toBeInTheDocument();
  });

  it('names the chosen engines in the units and the share context', async () => {
    renderWithProviders(
      <Harness filters={{ ...FILTERS, engines: ['chatgpt_web', 'gemini_web'] }} engines={ENGINES.slice(0, 2)} />,
    );
    const summary = await strip();
    expect(
      await within(summary).findByText('of 18,420 units in 4,812 answers, ChatGPT and Gemini'),
    ).toBeInTheDocument();
    expect(within(summary).getByText('1,912 of 18,420 units, ChatGPT and Gemini')).toBeInTheDocument();
    expect(within(summary).queryByText(/all engines/)).toBeNull();
  });

  it('shows no change figure: the detail has no period before it, so a zero would be a lie', async () => {
    renderWithProviders(<Harness />);
    const summary = await strip();
    await within(summary).findByText('1,912');
    expect(within(summary).queryByText(/vs |change|\+|−/i)).toBeNull();
  });

  it('says the answers and prompts are not known for a domain read in several roles, never a sum', async () => {
    serve(
      detailOf({
        rows: [rowOf(), rowOf({ domain_role: 'own', role_entity_id: 'ent-own', observations: 90, prompts: 12 })],
      }),
    );
    renderWithProviders(<Harness />);
    const summary = await strip();
    expect(await within(summary).findByText('3,824')).toBeInTheDocument();
    expect(within(summary).queryByText('730')).toBeNull();
    expect(within(summary).queryByText('60')).toBeNull();
    expect(within(summary).getAllByText('n/a')).toHaveLength(2);
    expect(
      within(summary).getAllByText(
        'The API counts answers for each role of this domain apart, so the total is not known.',
      ),
    ).not.toHaveLength(0);
  });
});

describe('the engine table', () => {
  it('says each share with its count', async () => {
    renderWithProviders(<Harness />);
    const table = await engineTable();
    const chatgpt = within(table).getByRole('rowheader', { name: 'ChatGPT' }).closest('tr');
    const gemini = within(table).getByRole('rowheader', { name: 'Gemini' }).closest('tr');
    const mode = within(table).getByRole('rowheader', { name: 'AI Mode' }).closest('tr');
    if (chatgpt === null || gemini === null || mode === null) throw new Error('A row is missing');
    expect(within(chatgpt).getByText('10.0%')).toBeInTheDocument();
    expect(within(chatgpt).getByText('700')).toBeInTheDocument();
    expect(within(chatgpt).getByText('700 of 7,000 units on ChatGPT')).toBeInTheDocument();
    expect(within(gemini).getByText('9.0%')).toBeInTheDocument();
    expect(within(gemini).getByText('540 of 6,000 units on Gemini')).toBeInTheDocument();
    expect(within(mode).getByText('12.4%')).toBeInTheDocument();
    expect(within(mode).getByText('672 of 5,420 units on AI Mode')).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Engine', 'Units', 'Share of the engine', 'Answers citing it']);
  });

  it('keeps the engines apart: no row adds them up', async () => {
    renderWithProviders(<Harness />);
    const table = await engineTable();
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3);
    expect(table.querySelector('tfoot')).toBeNull();
  });

  it('says n/a with the reason for an engine with no citation, never 0%', async () => {
    serve(
      detailOf({
        engines: [
          { engine_code: 'chatgpt_web', series: weeks(700, 7000) },
          { engine_code: 'gemini_web', series: weeks(540, 6000) },
          { engine_code: 'google_ai_mode', series: weeks(0, 0) },
        ],
        rows: [
          rowOf({
            engines: [
              { engine_code: 'chatgpt_web', citation_units: 700 },
              { engine_code: 'gemini_web', citation_units: 540 },
            ],
          }),
        ],
      }),
    );
    const { user } = renderWithProviders(<Harness />);
    const table = await engineTable();
    const mode = within(table).getByRole('rowheader', { name: 'AI Mode' }).closest('tr');
    if (mode === null) throw new Error('The AI Mode row is missing');
    expect(within(mode).queryByText(/%/)).toBeNull();
    await user.hover(within(mode).getByText('n/a'));
    await waitFor(() => expect(tooltip()).toHaveTextContent('AI Mode has no citation in this window.'));
  });

  it('says an engine that asked and was never cited has 0 units and 0 answers, and no share', async () => {
    serve(
      detailOf({
        engines: [
          { engine_code: 'chatgpt_web', series: weeks(700, 7000) },
          { engine_code: 'gemini_web', series: weeks(540, 6000) },
          { engine_code: 'google_ai_mode', series: weeks(0, 0) },
        ],
        rows: [
          rowOf({
            engines: [
              { engine_code: 'chatgpt_web', citation_units: 700 },
              { engine_code: 'gemini_web', citation_units: 540 },
            ],
          }),
        ],
      }),
    );
    renderWithProviders(<Harness />);
    const table = await engineTable();
    const mode = within(table).getByRole('rowheader', { name: 'AI Mode' }).closest('tr');
    if (mode === null) throw new Error('The AI Mode row is missing');
    expect(within(mode).getAllByText('0')).toHaveLength(2);
    expect(within(mode).getAllByText('n/a')).toHaveLength(1);
  });

  it('says n/a with the reason, not 0, for the units and answers of an engine that has no answer', async () => {
    serve(
      detailOf({
        engines: [
          { engine_code: 'chatgpt_web', series: weeks(700, 7000) },
          { engine_code: 'gemini_web', series: weeks(540, 6000) },
          {
            engine_code: 'google_ai_mode',
            series: [
              { week_start: '2026-10-19', citation_units: 0, observations: 0, all_citation_units: 0, answers: 0 },
            ],
          },
        ],
        rows: [
          rowOf({
            engines: [
              { engine_code: 'chatgpt_web', citation_units: 700 },
              { engine_code: 'gemini_web', citation_units: 540 },
            ],
          }),
        ],
      }),
    );
    const { user } = renderWithProviders(<Harness />);
    const table = await engineTable();
    const mode = within(table).getByRole('rowheader', { name: 'AI Mode' }).closest('tr');
    if (mode === null) throw new Error('The AI Mode row is missing');
    expect(within(mode).queryByText('0')).toBeNull();
    const unknown = within(mode).getAllByText('n/a');
    expect(unknown).toHaveLength(3);
    const [units] = unknown;
    if (units === undefined) throw new Error('The units cell is missing');
    await user.hover(units);
    await waitFor(() => expect(tooltip()).toHaveTextContent('AI Mode has no answer in this window.'));
  });

  it('says the citations of an engine are not known when the read has no series for it', async () => {
    serve(detailOf({ engines: [{ engine_code: 'chatgpt_web', series: weeks(700, 7000) }] }));
    renderWithProviders(<Harness />);
    const table = await engineTable();
    const gemini = within(table).getByRole('rowheader', { name: 'Gemini' }).closest('tr');
    if (gemini === null) throw new Error('The Gemini row is missing');
    expect(within(gemini).queryByText(/%/)).toBeNull();
    expect(within(gemini).getAllByText('n/a')).toHaveLength(3);
  });
});

describe('the domain inspector states', () => {
  it('shows the strip as bars and a skeleton while it loads, with the header in place', async () => {
    const held = gate();
    server.use(
      http.get(DETAIL, async () => {
        await held.opened;
        return HttpResponse.json(detailOf());
      }),
    );
    renderWithProviders(<Harness />);
    const inspector = await panel();
    const summary = await strip();
    expect(summary).toHaveAttribute('aria-busy', 'true');
    // The labels stay, the values are bars: no figure and no zero yet
    expect(within(summary).getByText('Citation units')).toBeInTheDocument();
    expect(within(summary).queryByText('1,912')).toBeNull();
    expect(within(summary).queryByText('0')).toBeNull();
    expect(within(inspector).getByRole('heading', { level: 2, name: 'g2.com' })).toBeInTheDocument();
    expect(inspector.querySelector('[aria-busy="true"]')).not.toBeNull();
    held.open();
    expect(await within(summary).findByText('1,912')).toBeInTheDocument();
    expect(summary).not.toHaveAttribute('aria-busy');
  });

  it('shows an inline error with Retry, keeps the header and reads again', async () => {
    let calls = 0;
    server.use(
      http.get(DETAIL, ({ request }) => {
        calls += 1;
        return calls === 1 ? problem(request, 'internal_error') : HttpResponse.json(detailOf());
      }),
    );
    const { user } = renderWithProviders(<Harness />);
    const inspector = await panel();
    expect(await within(inspector).findByText('This domain could not be loaded.')).toBeInTheDocument();
    expect(within(inspector).getByRole('heading', { level: 2, name: 'g2.com' })).toBeInTheDocument();
    expect(within(inspector).queryByRole('group', { name: 'Domain summary' })).toBeNull();
    await user.click(within(inspector).getByRole('button', { name: 'Try again' }));
    expect(await within(inspector).findByText('1,912')).toBeInTheDocument();
    expect(within(inspector).queryByText('This domain could not be loaded.')).toBeNull();
  });

  it('says a domain that is not cited is not, and draws no figure and no zero', async () => {
    serve(NOT_CITED);
    renderWithProviders(<Harness />);
    const inspector = await panel();
    expect(await within(inspector).findByText('Not cited in this window')).toBeInTheDocument();
    expect(
      within(inspector).getByText(
        'No answer read in this window cites g2.com. Choose a longer window or another engine.',
      ),
    ).toBeInTheDocument();
    expect(within(inspector).queryByRole('group', { name: 'Domain summary' })).toBeNull();
    expect(within(inspector).queryByRole('table')).toBeNull();
    expect(within(inspector).queryByText('0')).toBeNull();
    expect(within(inspector).queryByText('Category n/a')).toBeNull();
  });

  it('says a project the caller cannot see is not there', async () => {
    server.use(http.get(DETAIL, ({ request }) => problem(request, 'not_found')));
    renderWithProviders(<Harness />);
    const inspector = await panel();
    expect(
      await within(inspector).findByText('This domain does not exist or you do not have access to it.'),
    ).toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says a name the API refuses is a domain that is not there, with no Retry', async () => {
    server.use(http.get(DETAIL, ({ request }) => problem(request, 'validation_failed')));
    renderWithProviders(<Harness registrable="not a domain" />);
    const inspector = await screen.findByRole('complementary', { name: 'not a domain' });
    expect(
      await within(inspector).findByText('This domain does not exist or you do not have access to it.'),
    ).toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('keeps the figures at full strength and marks them busy while another window is read', async () => {
    const held = gate();
    let calls = 0;
    server.use(
      http.get(DETAIL, async () => {
        calls += 1;
        if (calls > 1) await held.opened;
        return HttpResponse.json(detailOf());
      }),
    );
    const view = renderWithProviders(<Harness />);
    const summary = await strip();
    await within(summary).findByText('1,912');
    view.rerender(<Harness filters={{ from: '2026-10-01', to: '2026-10-28' }} />);
    await waitFor(() => expect(calls).toBe(2));
    // The last figures stay while the new window is read, and the strip says it is busy
    expect(within(await strip()).getByText('1,912')).toBeInTheDocument();
    expect(await strip()).toHaveAttribute('aria-busy', 'true');
    expect(within(await engineTable()).getByText('10.0%')).toBeInTheDocument();
    held.open();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Domain summary' })).not.toHaveAttribute('aria-busy'));
  });

  it('does not show the last domain under the name of the next one while it reads', async () => {
    const held = gate();
    server.use(
      http.get(DETAIL, async ({ params }) => {
        if (params.registrable_domain === 'hubspot.com') await held.opened;
        return HttpResponse.json(detailOf());
      }),
    );
    const view = renderWithProviders(<Harness />);
    await within(await strip()).findByText('1,912');
    view.rerender(<Harness registrable="hubspot.com" />);
    expect(await screen.findByRole('heading', { level: 2, name: 'hubspot.com' })).toBeInTheDocument();
    expect(within(await strip()).queryByText('1,912')).toBeNull();
    held.open();
  });
});
