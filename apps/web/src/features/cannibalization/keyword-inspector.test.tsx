import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CannScreen, type CannScreenProps } from './cann-screen';
import { CannKeywordInspector } from './keyword-inspector';
import { PermissionProvider } from '@/lib/permissions';
import {
  cannCheck,
  cannConflicts,
  cannDetail,
  cannKeyword,
  cannPage,
  cannPairs,
  cannSwitches,
} from '@/mocks/cannibalization-fixture';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

// jsdom has no canvas: the chart draws on a stub
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => null }));

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const BASE = `*/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}/cannibalization`;
const PROPS: CannScreenProps = {
  workspaceId: MOCK_WORKSPACE.workspace_id,
  workspaceSlug: 'digibranders',
  project: { id: fynix.project_id, slug: 'fynix', name: 'Fynix' },
  tab: 'cannibalization',
  keywordInspector: (
    <CannKeywordInspector
      workspaceId={MOCK_WORKSPACE.workspace_id}
      workspaceSlug="digibranders"
      projectId={fynix.project_id}
      projectSlug="fynix"
      tab="cannibalization"
    />
  ),
};

const PAGES = [
  cannPage('a', 'A', 12, { path: '/blog/guide', title: 'Guide to endpoint security', share: 0.8, median: 4 }),
  cannPage('b', 'B', 9, { path: '/blog/compared', title: 'Endpoint security compared', is_target: true }),
];
const KEYWORD = cannKeyword('alpha', 'likely', {
  rank_gap: 6,
  volume: 1200,
  pages: PAGES,
  on_target: false,
  target_url_id: 'b',
  switches: [
    {
      date: '2026-11-03',
      from_url_id: 'a',
      to_url_id: 'b',
      rank_before: 4,
      rank_after: 9,
      held_days: 5,
      is_flip_flop: true,
    },
  ],
  strip: [
    { date: '2026-11-01', kind: 'page', url_id: 'a', rank: 3, together: false },
    { date: '2026-11-02', kind: 'page', url_id: 'b', rank: 8, together: false },
  ],
});
const CHECKS = [cannCheck('2026-11-01', { a: 3, b: 12 }), cannCheck('2026-11-02', { a: 11, b: 8 })];

function serve(status: 'ok' | 'missing' | 'error' = 'ok'): { asked: URL[] } {
  const asked: URL[] = [];
  server.use(
    http.get(BASE, () => HttpResponse.json({ data: cannConflicts([KEYWORD]) })),
    http.get(`${BASE}/pairs`, () => HttpResponse.json({ data: cannPairs() })),
    http.get(`${BASE}/switches`, () => HttpResponse.json({ data: cannSwitches([]) })),
    http.get(`${BASE}/keywords/alpha`, ({ request }) => {
      asked.push(new URL(request.url));
      if (status === 'missing') return problem(request, 'not_found');
      if (status === 'error') return problem(request, 'internal_error');
      return HttpResponse.json({ data: cannDetail(KEYWORD, CHECKS) });
    }),
  );
  return { asked };
}

function render(options: ProvidedRenderOptions = {}, role: 'editor' | 'viewer' = 'editor') {
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory(role)}>
      <CannScreen {...PROPS} />
    </PermissionProvider>,
    options,
  );
}

beforeEach(() => {
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  restoreWideScreen();
  vi.restoreAllMocks();
});

describe('the keyword inspector', () => {
  it('reads the keyword over the page device and period and shows the evidence', async () => {
    const { asked } = serve();
    const { container } = render({ searchParams: 'inspect=cann-keyword:alpha&device=mobile&days=14' });
    const drawer = await screen.findByRole('complementary', { name: 'alpha' });
    expect(await within(drawer).findByText(/took turns as the ranking page 1 time/)).toBeVisible();
    expect(within(drawer).getByText('/blog/guide and /blog/compared', { exact: false })).toBeVisible();
    expect(within(drawer).getByText('+6')).toBeVisible();
    expect(within(drawer).getByRole('heading', { name: 'Rank by page' })).toBeVisible();
    // causes are hypotheses, and the target mismatch is named
    expect(within(drawer).getByText('Hypotheses, not findings')).toBeVisible();
    expect(within(drawer).getByText('The target page is /blog/compared, but /blog/guide ranks.')).toBeVisible();
    expect(within(drawer).getByRole('link', { name: 'Open the SERP snapshot' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/seo/keywords/alpha?tab=snapshots',
    );
    expect(within(drawer).getByText('Same section of the site', { exact: false })).toBeVisible();
    expect(asked[0]?.searchParams.get('device')).toBe('mobile');
    expect(asked[0]?.searchParams.get('days')).toBe('14');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the lanes and the switches on the Timeline tab', async () => {
    serve();
    render({ searchParams: 'inspect=cann-keyword:alpha&itab=timeline' });
    const lanes = await screen.findByRole('group', { name: /Ranking page on each of the last 2 checks\./ });
    expect(lanes).toHaveAccessibleName(/Page A, \/blog\/guide: ranking page on 1 check\./);
    const cells = within(screen.getByRole('group', { name: /Page A, \/blog\/guide: one cell per check/ })).getAllByRole(
      'img',
    );
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveAccessibleName('Nov 1: rank 3, the ranking page');
    const table = screen.getByRole('table', { name: 'Confirmed switches of the ranking page' });
    expect(within(table).getByText('Flip-flop')).toBeVisible();
    expect(within(table).getByText('4 to 9')).toBeVisible();
    expect(within(table).getByText('5 days')).toBeVisible();
  });

  it('lists each page with its badges, its address as an external link and its numbers on the Pages tab', async () => {
    serve();
    render({ searchParams: 'inspect=cann-keyword:alpha&itab=pages' });
    const link = await screen.findByRole('link', { name: '/blog/compared, opens the page in a new tab' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Best page')).toBeVisible();
    expect(screen.getByText('Target page')).toBeVisible();
    expect(screen.getByText('80% of checks')).toBeVisible();
  });

  it('says so when the keyword is gone, and offers Try again when the read fails', async () => {
    serve('missing');
    const first = render({ searchParams: 'inspect=cann-keyword:alpha' });
    expect(await screen.findByText('This keyword is not in the table')).toBeVisible();
    first.unmount();
    serve('error');
    render({ searchParams: 'inspect=cann-keyword:alpha' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible());
  });
});

describe('the keyword inspector, part 2', () => {
  const GROUPS = `*/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}/keyword-groups`;
  const PATCH = `*/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}/tracked-keywords/alpha`;

  it("names the keyword's groups in the header", async () => {
    serve();
    server.use(
      http.get(GROUPS, () => HttpResponse.json({ data: [{ group_id: 'g1', path: 'Services / Audits' }] })),
      http.get(`${BASE}/keywords/alpha`, () =>
        HttpResponse.json({ data: cannDetail({ ...KEYWORD, group_ids: ['g1'] }, CHECKS) }),
      ),
    );
    render({ searchParams: 'inspect=cann-keyword:alpha' });
    const drawer = await screen.findByRole('complementary', { name: 'alpha' });
    expect(await within(drawer).findByText('Group: Services / Audits')).toBeVisible();
  });

  it('explains each figure and says one-check changes were not counted', async () => {
    serve();
    server.use(
      http.get(`${BASE}/keywords/alpha`, () =>
        HttpResponse.json({ data: cannDetail({ ...KEYWORD, one_check_changes: 2 }, CHECKS) }),
      ),
    );
    const user = userEvent.setup();
    render({ searchParams: 'inspect=cann-keyword:alpha' });
    const drawer = await screen.findByRole('complementary', { name: 'alpha' });
    const switches = await within(drawer).findByText('1');
    await user.tab();
    switches.focus();
    expect(switches).toHaveAccessibleDescription(
      /Confirmed switches in the last 30 days\. 2 one-check changes were not counted\./,
    );
  });

  it('sets a page as the target page with one press and says so', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.patch(PATCH, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: { tracked_keyword_id: 'alpha' } });
      }),
    );
    const user = userEvent.setup();
    render({ searchParams: 'inspect=cann-keyword:alpha' });
    await screen.findByRole('complementary', { name: 'alpha' });
    await user.click(await screen.findByRole('button', { name: 'Set /blog/guide as target page' }));
    await waitFor(() => expect(bodies).toEqual([{ target_url: 'https://example.com/a' }]));
    expect(screen.queryByRole('button', { name: 'Set /blog/compared as target page' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear target page, now /blog/compared' })).toBeVisible();
  });

  it('clears the target page with null', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.patch(PATCH, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: { tracked_keyword_id: 'alpha' } });
      }),
    );
    const user = userEvent.setup();
    render({ searchParams: 'inspect=cann-keyword:alpha' });
    await user.click(await screen.findByRole('button', { name: 'Clear target page, now /blog/compared' }));
    await waitFor(() => expect(bodies).toEqual([{ target_url: null }]));
  });

  it('offers no write without permission to edit keywords', async () => {
    serve();
    render({ searchParams: 'inspect=cann-keyword:alpha' }, 'viewer');
    await screen.findByRole('complementary', { name: 'alpha' });
    expect(await screen.findByText('Setting a target page needs permission to edit keywords.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /target page/ })).not.toBeInTheDocument();
  });

  it('closes when the keyword is not in the table any more', async () => {
    serve();
    server.use(http.get(`${BASE}/keywords/gone`, ({ request }) => problem(request, 'not_found')));
    render({ searchParams: 'inspect=cann-keyword:gone' });
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
  });
});
