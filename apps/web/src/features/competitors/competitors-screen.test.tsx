import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompetitorsScreen, type CompetitorsProject } from './competitors-screen';
import { useAddCompetitorControl } from './add-competitor-control';
import { competitorsBody, competitorRow, OWN_ID } from './model/competitors-fixtures';
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
const SUMMARY = mswPath(`${P}/ai/prompts-summary`);

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
    http.get(SUMMARY, () =>
      HttpResponse.json({ data: { total: { last_observed_at: '2026-11-11T01:00:00Z' } }, meta: {} }),
    ),
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
    expect(screen.queryByText('No engine is on')).toBeNull();
    expect(screen.queryByText('Competitors could not be loaded')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    release();
  });

  it('no engine on shows the no engine state with the settings link for an editor and the admin sentence for a viewer', async () => {
    const seen = watch();
    const editor = renderWithProviders(screenAs('editor', asProject(cleanstart)));
    expect(await screen.findByRole('heading', { name: 'No engine is on' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Engines' })).toHaveAttribute(
      'href',
      '/digibranders/cleanstart/settings/engines',
    );
    editor.unmount();
    renderWithProviders(screenAs('viewer', asProject(cleanstart)));
    expect(await screen.findByText('Ask a workspace admin to turn on an engine.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Engines' })).toBeNull();
    expect(to(seen, '/ai/competitors')).toHaveLength(0);
  });

  it('the engines read failing shows Retry and no empty list', async () => {
    let calls = 0;
    server.use(
      http.get(ENGINES, ({ request }) => {
        calls += 1;
        return calls === 1 ? problem(request, 'not_found') : HttpResponse.json({ data: [] });
      }),
    );
    const { user } = render();
    expect(await screen.findByText('Competitors could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No engine is on')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No engine is on')).toBeInTheDocument();
  });

  it('the header has the title, the meta line, the saved view menu and the primary Add competitor only with entities:write', async () => {
    const admin = render('admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Competitors' })).toBeInTheDocument();
    expect(await screen.findByText('AI updated 1d ago, 2 tracked competitors')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Default/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add competitor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    admin.unmount();
    render('analyst');
    expect(await screen.findByRole('heading', { level: 1, name: 'Competitors' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add competitor' })).toBeNull();
  });

  it('Add competitor hands the open state to the slot, and closing it refreshes the reads', async () => {
    const seen = watch();
    const { user } = render('admin');
    await user.click(await screen.findByRole('button', { name: 'Add competitor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add competitor dialog' });
    await waitFor(() => expect(to(seen, '/ai/competitors').length).toBeGreaterThan(0));
    const before = to(seen, '/ai/competitors').length;
    await user.click(within(dialog).getByRole('button', { name: 'Close the dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(to(seen, '/ai/competitors').length).toBeGreaterThan(before));
  });

  it('tabs write tab to the address and the panel follows', async () => {
    const updates: string[] = [];
    const { user } = render('admin', '', { onUrlUpdate: (event) => updates.push(event.queryString) });
    const tabs = await screen.findByRole('tablist', { name: 'Competitor views' });
    const listed = within(tabs).getAllByRole('tab');
    ['Comparison', 'SEO', 'AI', 'Candidates'].forEach((name, index) => {
      expect(listed[index]).toHaveAccessibleName(name);
    });
    expect(listed).toHaveLength(4);
    expect(within(tabs).getByRole('tab', { name: 'Comparison' })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(tabs).getByRole('tab', { name: 'SEO' }));
    expect(updates.at(-1)).toContain('tab=seo');
    expect(await screen.findByRole('heading', { name: 'Search competitors are not measured yet' })).toBeInTheDocument();
    await user.click(within(tabs).getByRole('tab', { name: 'Candidates' }));
    expect(await screen.findByRole('heading', { name: 'Candidate brands are not listed yet' })).toBeInTheDocument();
    await user.click(within(tabs).getByRole('tab', { name: 'Comparison' }));
    expect(updates.at(-1)).not.toContain('tab=');
  });

  it('reads the tab from a link, and SEO and Candidates ask for nothing', async () => {
    const seen = watch();
    render('admin', '?tab=seo');
    expect(await screen.findByRole('heading', { name: 'Search competitors are not measured yet' })).toBeInTheDocument();
    expect(to(seen, '/ai/competitors')).toHaveLength(0);
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(0);
  });

  it('a link with no competitor tracked says so on the Comparison tab, with Add competitor for a writer', async () => {
    server.use(
      http.get(COMPETITORS, () => HttpResponse.json(competitorsBody([competitorRow(OWN_ID, 'Fynix', 'own', 1)]))),
    );
    render('admin');
    expect(await screen.findByRole('heading', { name: 'No competitor is tracked' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add competitor' }).length).toBeGreaterThan(0);
  });

  it('a read of the tracked set that failed says so with Retry, and the header and tabs stay', async () => {
    let calls = 0;
    server.use(
      http.get(COMPETITORS, ({ request }) => {
        if (new URL(request.url).searchParams.has('include')) return HttpResponse.json(competitorsBody());
        calls += 1;
        return calls === 1 ? problem(request, 'not_found') : HttpResponse.json(competitorsBody());
      }),
    );
    const { user } = render('admin');
    expect(await screen.findByText('Competitor figures could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Competitors' })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText('Competitor figures could not be loaded')).toBeNull());
  });

  it("a link's dropped range shows its banner", async () => {
    render('admin', '?from=2026-01-01&to=2026-11-01');
    expect(
      await screen.findByText('The link asked for more than 92 days, so the last 28 days are shown.'),
    ).toBeInTheDocument();
  });

  it('the filter row and the compare control belong to Comparison and AI, and the country control is in the top bar', async () => {
    render('admin');
    expect(await screen.findByRole('button', { name: 'Add a filter' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('vs previous period');
  });

  it('keeps the link of the drilldown: the engine of the link narrows the scope and the filter chip says so', async () => {
    const seen = watch();
    render('admin', '?engine=gemini_web&country=DE');
    await waitFor(() => expect(to(seen, '/ai/competitors').length).toBeGreaterThan(0));
    const asked = to(seen, '/ai/competitors')[0];
    expect(asked?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    expect(asked?.searchParams.get('filter[country_iso]')).toBe('DE');
  });
});
