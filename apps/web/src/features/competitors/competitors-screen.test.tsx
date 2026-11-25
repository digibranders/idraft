import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompetitorsScreen, type CompetitorsProject } from './competitors-screen';
import { useAddCompetitorControl } from './add-competitor-control';
import {
  competitorRow,
  competitorsBody,
  engineCells,
  HUBSPOT_ID,
  metricValue,
  OWN_ID,
  ZOHO_ID,
} from './model/competitors.test-fixtures';
import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/competitors',
  useSearchParams: () => new URLSearchParams(),
}));

// jsdom has no canvas: a chart of a later task is a stand-in
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

/** Thursday 12 November 2026, noon UTC. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = mswPath(`${P}/engines`);
const COMPETITORS = mswPath(`${P}/ai/competitors`);
const SERIES = mswPath(`${P}/ai/metrics/{metric}/series`);
const KEYWORDS = mswPath(`${P}/tracked-keywords`);

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const asProject = (project: (typeof MOCK_PROJECTS)[number]): CompetitorsProject => ({
  id: project.project_id,
  slug: project.slug,
  name: project.name,
  timeZone: project.timezone,
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  server.use(
    http.get(COMPETITORS, () => HttpResponse.json(competitorsBody())),
    http.get(SERIES, () => HttpResponse.json({ data: [], meta: competitorsBody().meta })),
  );
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
});

/** The route's slot, as a test double: a marker that shows what the screen hands it. */
function TestSlot(): ReactElement | null {
  const control = useAddCompetitorControl();
  if (!control.open) return null;
  return (
    <div role="dialog" aria-label="Add competitor dialog">
      <button type="button" onClick={control.close}>
        Close the dialog
      </button>
    </div>
  );
}

const fynixProject = asProject(fynix);

function screenAs(role: Role, project: CompetitorsProject = fynixProject): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <TopBarSlotProvider>
      <TopBarSlotTarget />
      <PermissionProvider membership={membershipFactory(role)}>
        <Suspense fallback={null}>
          <CompetitorsScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={project}
            addCompetitorSlot={<TestSlot />}
          />
        </Suspense>
      </PermissionProvider>
    </TopBarSlotProvider>
  );
}

const render = (role: Role = 'admin', searchParams = '', options: ProvidedRenderOptions = {}) =>
  renderWithProviders(screenAs(role), { searchParams, ...options });

/** Every request the mock server saw, as URLs. */
function watch(): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => seen.push(new URL(request.url)));
  return seen;
}
const to = (seen: readonly URL[], route: string): URL[] => seen.filter((url) => url.pathname.endsWith(route));

/** Three tracked entities with distinct values, so a figure on screen says which cell it came from. */
const distinct = (): ReturnType<typeof competitorsBody> =>
  competitorsBody([
    competitorRow(OWN_ID, 'Fynix', 'own', 1, [
      engineCells('chatgpt_web', {
        share_of_voice: metricValue({
          value: 0.2,
          previous: { value: 0.15, numerator: 15, denominator: 100, n_observations: 100 },
        }),
        mention_rate: metricValue({ value: 0.41 }),
        citation_share: metricValue({ value: 0.12 }),
      }),
    ]),
    competitorRow(HUBSPOT_ID, 'HubSpot', 'competitor', 2, [
      engineCells('chatgpt_web', {
        share_of_voice: metricValue({ value: 0.55 }),
        mention_rate: metricValue({ value: 0.63 }),
        citation_share: metricValue({ value: 0.31 }),
        lost_prompts_total: 7,
        lost_prompts_with_min_answers: 40,
        lost_prompts: [
          {
            prompt_id: 'pr1',
            text: 'best crm for startups',
            importance: 1,
            lost: { value: 1, numerator: 1, denominator: 1, n_observations: 1 },
          } as never,
        ],
      }),
    ]),
    competitorRow(ZOHO_ID, 'Zoho', 'competitor', 3, [
      engineCells('chatgpt_web', {
        share_of_voice: metricValue({ value: 0.1 }),
        mention_rate: metricValue({ value: 0.22 }),
        citation_share: metricValue({ value: 0.05 }),
        lost_prompts_total: 2,
        lost_prompts_with_min_answers: 40,
      }),
    ]),
  ]);

const TABS = ['Competitors', 'Mentions', 'Citations', 'Share of voice', 'AI visibility', 'SEO ranking'] as const;

describe('Competitors page', () => {
  it('a member without data:read is told so and nothing is read', async () => {
    const seen = watch();
    render('billing');
    expect(await screen.findByRole('heading', { name: 'You cannot open competitors' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(seen.filter((url) => url.pathname.includes('/ai/') || url.pathname.endsWith('/engines'))).toHaveLength(0);
  });

  it('engines loading shows the skeleton, not an empty state', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(ENGINES, async () => {
        await held;
        return HttpResponse.json({ data: [] });
      }),
    );
    render();
    expect(await screen.findByRole('heading', { level: 1, name: 'Competitors' })).toBeInTheDocument();
    expect(screen.getByTestId('competitors-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('No platform is on')).toBeNull();
    release();
  });

  it('lists the six tabs in order, Competitors first', async () => {
    render();
    const tabs = await screen.findAllByRole('tab');
    // The tab draws its label twice (one hidden, to hold the width when it is selected)
    expect(tabs.map((tab) => (tab.textContent ?? '').slice(0, (tab.textContent ?? '').length / 2))).toEqual([...TABS]);
    expect(screen.getByRole('tab', { name: 'Competitors' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Competitors: the strip, three charts and a table with each metric of every entity', async () => {
    server.use(http.get(COMPETITORS, () => HttpResponse.json(distinct())));
    render();
    const table = await screen.findByRole('table', {
      name: /Brands with share of voice, mention rate and citation share/,
    });
    expect(table).toHaveTextContent('Fynix');
    expect(table).toHaveTextContent('HubSpot');
    expect(table).toHaveTextContent('Zoho');
    // Competitors by share of voice, highest first, with the own brand on top
    const names = screen.getAllByRole('row').map((row) => row.textContent ?? '');
    expect(names.findIndex((text) => text.includes('HubSpot'))).toBeLessThan(
      names.findIndex((text) => text.includes('Zoho')),
    );
    expect(table).toHaveTextContent('55.0%');
    expect(table).toHaveTextContent('63.0%');
    expect(table).toHaveTextContent('31.0%');
    expect(screen.getByText('Share of voice by brand')).toBeInTheDocument();
    expect(screen.getByText('Mention rate by brand')).toBeInTheDocument();
    expect(screen.getByText('Share of voice over time')).toBeInTheDocument();
    // The strip answers questions: where you stand, who leads, by how much, and who is moving
    expect(screen.getByText('Your rank')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('of 3 brands')).toBeInTheDocument();
    expect(screen.getByText('Top competitor')).toBeInTheDocument();
    expect(screen.getByText('Gap to the top competitor')).toBeInTheDocument();
    expect(screen.getByText('You trail')).toBeInTheDocument();
    expect(screen.getByText('Biggest mover')).toBeInTheDocument();
  });

  it.each([
    ['mentions', /Mention rate of every tracked brand/, '63.0%', 'Mention rate over time'],
    ['citations', /Citation share of every tracked brand/, '31.0%', null],
    ['sov', /Share of voice of every tracked brand/, '55.0%', 'Share of voice over time'],
  ])('%s tab: one metric across the set, with its charts and table', async (tab, caption, figure, trend) => {
    server.use(http.get(COMPETITORS, () => HttpResponse.json(distinct())));
    render('admin', `?tab=${tab}`);
    const table = await screen.findByRole('table', { name: caption });
    expect(table).toHaveTextContent('HubSpot');
    expect(table).toHaveTextContent(figure);
    expect(table).toHaveTextContent('ChatGPT');
    expect(screen.getByText('Competitors ahead of you')).toBeInTheDocument();
    expect(screen.getByText('of 2 competitors')).toBeInTheDocument();
    if (trend === null) {
      expect(screen.queryByText(/over time/)).toBeNull();
    } else {
      expect(screen.getByText(trend)).toBeInTheDocument();
    }
  });

  it('Share of voice asks the weekly series for every tracked entity, Mentions asks the mention rate', async () => {
    const seen = watch();
    server.use(http.get(COMPETITORS, () => HttpResponse.json(distinct())));
    const sov = render('admin', '?tab=sov');
    await waitFor(() => expect(seen.some((url) => url.pathname.endsWith('/ai.share_of_voice/series'))).toBe(true));
    const asked = seen.find((url) => url.pathname.endsWith('/ai.share_of_voice/series'));
    expect(asked?.searchParams.getAll('entity_ids').length ?? asked?.searchParams.get('entity_ids')).toBeTruthy();
    sov.unmount();
    render('admin', '?tab=mentions');
    await waitFor(() => expect(seen.some((url) => url.pathname.endsWith('/ai.mention_rate/series'))).toBe(true));
  });

  it('AI visibility: the platform matrix, prompts lost per competitor and the prompts lost to the top one', async () => {
    const seen = watch();
    server.use(http.get(COMPETITORS, () => HttpResponse.json(distinct())));
    render('admin', '?tab=visibility');
    expect(
      await screen.findByRole('table', { name: /Mention rate of every brand on every platform/ }),
    ).toHaveTextContent('63.0%');
    expect(await screen.findByText('best crm for startups')).toBeInTheDocument();
    expect(screen.getByText('Your strongest platform')).toBeInTheDocument();
    expect(screen.getByText('Most prompts lost to')).toBeInTheDocument();
    expect(screen.getByText('7 prompts')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /Prompts lost to each competitor/ })).toHaveTextContent('HubSpot');
    expect(to(seen, '/ai/competitors').some((url) => url.searchParams.get('include') === 'lost_prompts')).toBe(true);
  });

  it('SEO ranking: ranks of the own brand and each competitor per keyword, and no AI read', async () => {
    const seen = watch();
    server.use(
      http.get(KEYWORDS, () =>
        HttpResponse.json({
          data: [
            {
              tracked_keyword_id: 'k1',
              keyword: { normalized_text: 'crm software' },
              state: { current: { rank: 7 } },
              competitor_ranks: [
                { entity: { entity_id: HUBSPOT_ID, canonical_name: 'HubSpot' }, current: { rank: 2 } },
                { entity: { entity_id: ZOHO_ID, canonical_name: 'Zoho' }, current: { rank: null } },
              ],
            },
          ],
          page: { total: 1, has_more: false, limit: 100, next_cursor: null },
        }),
      ),
    );
    render('admin', '?tab=seo');
    const table = await screen.findByRole('table', { name: /Rank of your brand and each competitor/ });
    expect(table).toHaveTextContent('crm software');
    expect(table).toHaveTextContent('HubSpot');
    expect(screen.getByText('Keywords in the top 10')).toBeInTheDocument();
    expect(screen.getByText(/do not apply here/)).toBeInTheDocument();
    expect(screen.getByText('Your average position')).toBeInTheDocument();
    expect(screen.getByText('Keywords where a competitor ranks higher')).toBeInTheDocument();
    expect(to(seen, '/ai/competitors')).toHaveLength(0);
    expect(to(seen, '/tracked-keywords')[0]?.searchParams.get('include')).toBe('competitor_ranks');
  });

  it('a tracked set with the own brand alone asks for a competitor, and a member who may add one can', async () => {
    server.use(
      http.get(COMPETITORS, () => HttpResponse.json(competitorsBody([competitorRow(OWN_ID, 'Fynix', 'own', 1)]))),
    );
    render();
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
  });

  it('a failed read says so, with a way to try again', async () => {
    server.use(http.get(COMPETITORS, ({ request }) => problem(request, 'not_found')));
    render();
    expect(await screen.findByText('Competitor figures could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('with no platform on, the tabs are not drawn', async () => {
    server.use(http.get(ENGINES, () => HttpResponse.json({ data: [] })));
    render();
    expect(await screen.findByText('No platform is on')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
