import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsightsBox } from './insights-box';
import { OverviewProvider } from '../overview-context';
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
  keywords: string[];
  prompts: string[];
  gaps: number;
  domains: { cited_with: { entity_id: string } | null }[];
  newDomains: number;
  failing?: 'gaps';
}

function serve(world: World): void {
  server.use(
    http.get(`${P}/tracked-keywords`, () =>
      HttpResponse.json({ data: world.keywords.map((text) => ({ keyword: { text } })), page: PAGE }),
    ),
    http.get(`${P}/prompts`, () =>
      HttpResponse.json({ data: world.prompts.map((text) => ({ current_version: { text } })), page: PAGE }),
    ),
    http.get(`${P}/ai/citation-gaps`, () =>
      world.failing === 'gaps'
        ? HttpResponse.json({ title: 'Boom', status: 500 }, { status: 500 })
        : HttpResponse.json({ data: [], meta: { gaps: world.gaps, prompts: 10, competitors: [] } }),
    ),
    http.get(`${P}/ai/sources/domains`, () =>
      HttpResponse.json({
        data: world.domains,
        page: { total: world.domains.length, limit: 200, offset: 0 },
        meta: {},
      }),
    ),
    http.get(`${P}/ai/sources/changes`, () =>
      HttpResponse.json({ data: [], meta: { min_support: 2 }, page: { total: world.newDomains, limit: 1, offset: 0 } }),
    ),
  );
}

function renderBox(): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <OverviewProvider
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        project={overviewProject('fynix')}
      >
        <InsightsBox />
      </OverviewProvider>
    </PermissionProvider>,
  );
}

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('InsightsBox', () => {
  it('shows each finding with its count and a link to the page that holds the work', async () => {
    serve({
      keywords: ['crm pricing', 'crm demo'],
      prompts: [],
      gaps: 5,
      domains: [{ cited_with: { entity_id: MOCK_ENTITY_IDS.brightwave } }, { cited_with: null }],
      newDomains: 3,
    });
    renderBox();
    const untracked = await screen.findByText(/not tracked as prompts/);
    expect(untracked.closest('li')).toHaveTextContent('2');
    const gaps = (await screen.findByText(/where a competitor is cited and your site is not/)).closest('li');
    expect(gaps).toHaveTextContent('5');
    expect(within(gaps as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('/ai/citations/gaps'),
    );
    const citing = (await screen.findByText(/tracked competitors/)).closest('li');
    expect(citing).toHaveTextContent('1');
    expect(within(citing as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('owner=third'),
    );
    expect((await screen.findByText(/new cited domains this month/)).closest('li')).toHaveTextContent('3');
  });

  it('leaves a line at zero out, and says there is nothing to do when every line is at zero', async () => {
    serve({ keywords: [], prompts: [], gaps: 0, domains: [], newDomains: 0 });
    renderBox();
    expect(await screen.findByText('Nothing to act on')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('fails one line alone and reads it again on Retry', async () => {
    serve({ keywords: ['a'], prompts: [], gaps: 4, domains: [], newDomains: 1, failing: 'gaps' });
    const { user } = renderBox();
    expect(await screen.findByText('Could not count the citation gaps')).toBeInTheDocument();
    expect(await screen.findByText(/new cited domain this month/)).toBeInTheDocument();
    serve({ keywords: ['a'], prompts: [], gaps: 4, domains: [], newDomains: 1 });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.queryByText('Could not count the citation gaps')).toBeNull();
    });
    expect(await screen.findByText(/where a competitor is cited and your site is not/)).toBeInTheDocument();
  });
});
