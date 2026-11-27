import { screen, waitFor, within } from '@testing-library/react';
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

function render(options: ProvidedRenderOptions = {}) {
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('editor')}>
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
    expect(within(drawer).getByRole('link', { name: 'Open this keyword on the Keywords page' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/seo/keywords/alpha',
    );
    expect(asked[0]?.searchParams.get('device')).toBe('mobile');
    expect(asked[0]?.searchParams.get('days')).toBe('14');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the lanes and the switches on the Timeline tab', async () => {
    serve();
    render({ searchParams: 'inspect=cann-keyword:alpha&itab=timeline' });
    const lanes = await screen.findByRole('img', { name: /Ranking page on each of the last 2 checks\./ });
    expect(lanes).toHaveAccessibleName(/Page A, \/blog\/guide: ranking page on 1 check\./);
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
    expect(await screen.findByText(/has no checks in the period/)).toBeVisible();
    first.unmount();
    serve('error');
    render({ searchParams: 'inspect=cann-keyword:alpha' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible());
  });
});
