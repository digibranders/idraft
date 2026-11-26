import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsightsScreen } from './insights-screen';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_ENTITY_IDS } from '@/mocks/entity-fixtures';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const P = '*/api/v1/workspaces/:w/projects/:p';
const PAGE = { has_more: false, next_cursor: null };

interface World {
  keywords: { text: string; volume: number | null; cited: boolean }[];
  prompts: string[];
  gaps: { prompt_id: string; text: string; lost_on: string[]; lost_to: string[] }[];
  domains: { registrable_domain: string; cited_with: { entity_id: string } | null }[];
  newDomains: { registrable_domain: string; first_seen_at: string | null }[];
  failing?: 'gaps' | 'entities';
  morePrompts?: boolean;
}

const failure = (): Response => HttpResponse.json({ title: 'Boom', status: 500 }, { status: 500 });

function serve(world: World): void {
  server.use(
    ...(world.failing === 'entities' ? [http.get(`${P}/entities`, failure)] : []),
    http.get(`${P}/tracked-keywords`, () =>
      HttpResponse.json({
        data: world.keywords.map((row) => ({
          keyword: { text: row.text },
          metrics: row.volume === null ? null : { search_volume: { value: row.volume } },
          aio: { state: row.cited ? 'present_cited' : 'present_not_cited' },
        })),
        page: PAGE,
      }),
    ),
    http.get(`${P}/prompts`, () =>
      HttpResponse.json({
        data: world.prompts.map((text) => ({ current_version: { text } })),
        page: { ...PAGE, has_more: world.morePrompts === true },
      }),
    ),
    http.get(`${P}/ai/citation-gaps`, () =>
      world.failing === 'gaps'
        ? failure()
        : HttpResponse.json({
            data: world.gaps.map((row) => ({ ...row, gap: row.lost_on.length })),
            meta: { gaps: world.gaps.length, prompts: 10, competitors: [] },
          }),
    ),
    http.get(`${P}/ai/sources/domains`, () =>
      HttpResponse.json({
        data: world.domains.map((row) => ({ domain_role: 'third_party', observations: 7, ...row })),
        page: { total: world.domains.length, limit: 200, offset: 0 },
        meta: {},
      }),
    ),
    http.get(`${P}/ai/sources/changes`, () =>
      HttpResponse.json({
        data: world.newDomains.map((row) => ({ domain_role: 'third_party', current_units: 4, ...row })),
        meta: { min_support: 2 },
        page: { total: world.newDomains.length, limit: 200, offset: 0 },
      }),
    ),
  );
}

const EMPTY: World = { keywords: [], prompts: [], gaps: [], domains: [], newDomains: [] };

function renderScreen(role: 'admin' | 'viewer' = 'admin'): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory(role)}>
      <InsightsScreen
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        project={overviewProject('fynix')}
      />
    </PermissionProvider>,
  );
}

const card = async (section: string): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(document.querySelector(`[data-insight="${section}"]`)).not.toBeNull();
  });
  return document.querySelector(`[data-insight="${section}"]`) as HTMLElement;
};

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('InsightsScreen', () => {
  it('lists the keywords that show a Google AI Overview and are not prompts, with volume, citation and a link', async () => {
    serve({
      ...EMPTY,
      keywords: [
        { text: 'crm pricing', volume: 1900, cited: true },
        { text: 'crm demo', volume: null, cited: false },
        { text: 'crm tracked', volume: 10, cited: false },
      ],
      prompts: ['crm tracked?'],
    });
    renderScreen();
    const untracked = await card('untracked');
    const pricing = (await within(untracked).findByRole('rowheader', { name: 'crm pricing' })).closest('tr');
    expect(pricing).toHaveTextContent('1,900');
    expect(pricing).toHaveTextContent('Cited');
    expect(within(pricing as HTMLElement).getByRole('link', { name: 'Start tracking: crm pricing' })).toHaveAttribute(
      'href',
      expect.stringContaining('/ai/prompts'),
    );
    const demo = within(untracked).getByRole('rowheader', { name: 'crm demo' }).closest('tr');
    expect(demo).toHaveTextContent('n/a');
    expect(demo).toHaveTextContent('Not cited');
    expect(within(untracked).queryByRole('rowheader', { name: 'crm tracked' })).toBeNull();
    expect(untracked).toHaveTextContent('2');
  });

  it('lists the prompts where a competitor is cited and your site is not, with platforms and competitor names', async () => {
    serve({
      ...EMPTY,
      gaps: [
        {
          prompt_id: 'p1',
          text: 'best crm for startups',
          lost_on: ['gemini_web'],
          lost_to: [MOCK_ENTITY_IDS.brightwave],
        },
      ],
    });
    renderScreen();
    const gaps = await card('gaps');
    const row = (await within(gaps).findByRole('rowheader', { name: 'best crm for startups' })).closest('tr');
    expect(within(row as HTMLElement).getByRole('link', { name: /View prompt/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/ai/prompts/p1'),
    );
    expect(row).toHaveTextContent('Brightwave');
  });

  it('lists the domains that cite a tracked competitor and the new cited domains with their first day', async () => {
    serve({
      ...EMPTY,
      domains: [
        { registrable_domain: 'crmreviews.com', cited_with: { entity_id: MOCK_ENTITY_IDS.brightwave } },
        { registrable_domain: 'other.com', cited_with: null },
      ],
      newDomains: [
        { registrable_domain: 'fresh.io', first_seen_at: '2026-11-10T08:00:00Z' },
        { registrable_domain: 'unknown.io', first_seen_at: null },
      ],
    });
    renderScreen();
    const citing = await card('citingCompetitors');
    expect(await within(citing).findByText('crmreviews.com')).toBeInTheDocument();
    expect(within(citing).queryByText('other.com')).toBeNull();
    expect(citing).toHaveTextContent('Brightwave');
    expect(citing).toHaveTextContent('7');
    const added = await card('newDomains');
    expect(await within(added).findByText('fresh.io')).toBeInTheDocument();
    expect(within(added).getByText('Nov 10, 08:00'.slice(0, 6))).toBeInTheDocument();
    expect(within(added).getByText('unknown.io').closest('tr')).toHaveTextContent('n/a');
  });

  it('says why a section is empty instead of showing zero rows', async () => {
    serve(EMPTY);
    renderScreen();
    expect(await screen.findByText('Every keyword with a Google AI Overview is a prompt')).toBeInTheDocument();
    expect(await screen.findByText('No citation gaps')).toBeInTheDocument();
    expect(await screen.findByText('No new cited domains')).toBeInTheDocument();
  });

  it('fails one section alone and reads it again on Try again', async () => {
    serve({ ...EMPTY, failing: 'gaps' });
    const { user } = renderScreen();
    expect(await screen.findByText('Could not count the citation gaps')).toBeInTheDocument();
    expect(await screen.findByText('No new cited domains')).toBeInTheDocument();
    serve(EMPTY);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No citation gaps')).toBeInTheDocument();
  });

  it('says what was not counted, never zero, when the prompts were cut', async () => {
    serve({ ...EMPTY, keywords: [{ text: 'a', volume: 1, cited: false }], prompts: ['p'], morePrompts: true });
    renderScreen();
    expect(await screen.findByText(/were not counted/)).toBeInTheDocument();
    expect(screen.queryByText('Every keyword with a Google AI Overview is a prompt')).toBeNull();
  });

  it('fails the sections that need the competitors when they cannot be read', async () => {
    serve({ ...EMPTY, failing: 'entities' });
    renderScreen();
    expect(await screen.findByText('Could not count the citation gaps')).toBeInTheDocument();
    expect(screen.getByText('Could not count the domains that cite your competitors')).toBeInTheDocument();
  });

  it('shows no access to a member who cannot read project data', async () => {
    serve(EMPTY);
    renderScreen('viewer');
    // The viewer role can read data; only a membership without `data:read` is turned away
    expect(await screen.findByRole('heading', { level: 1, name: 'Insights' })).toBeInTheDocument();
  });
});
