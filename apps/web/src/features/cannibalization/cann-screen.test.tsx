import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CannScreen, type CannScreenProps } from './cann-screen';
import { PermissionProvider } from '@/lib/permissions';
import {
  cannConflicts,
  cannKeyword,
  cannPage,
  cannPairs,
  cannSwitchRow,
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

const saved = vi.hoisted(() => ({ blobs: [] as { blob: Blob; name: string }[] }));
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/csv/csv-write')>()),
  downloadBlob: (blob: Blob, name: string) => saved.blobs.push({ blob, name }),
}));

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
};

const STRIP = [
  { t: 0, x: 'a' },
  { t: 1, x: 'b' },
  { t: 2, x: 'a' },
].map(({ t, x }) => ({
  date: `2026-11-0${String(t + 1)}`,
  kind: 'page' as const,
  url_id: x,
  rank: 3,
  together: false,
}));
const KEYWORDS = [
  cannKeyword('alpha', 'likely', {
    rank_gap: 6,
    volume: 1200,
    strip: STRIP,
    on_target: false,
    target_url_id: 'b',
    pages: [cannPage('a', 'A'), cannPage('b', 'B', 8)],
  }),
  cannKeyword('beta', 'co_ranking', { together_rate: 0.6 }),
  cannKeyword('gamma', 'none'),
  cannKeyword('zeta', 'insufficient'),
];

function serve(): { asked: URL[] } {
  const asked: URL[] = [];
  server.use(
    http.get(BASE, ({ request }) => {
      asked.push(new URL(request.url));
      return HttpResponse.json({ data: cannConflicts(KEYWORDS) });
    }),
    http.get(`${BASE}/pairs`, () => HttpResponse.json({ data: cannPairs() })),
    http.get(`${BASE}/switches`, () =>
      HttpResponse.json({
        data: cannSwitches([cannSwitchRow('alpha'), cannSwitchRow('beta', { rank_change: -2, left_target: true })]),
      }),
    ),
  );
  return { asked };
}

function render(options: ProvidedRenderOptions = {}, props: Partial<CannScreenProps> = {}) {
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('editor')}>
      <CannScreen {...PROPS} {...props} />
    </PermissionProvider>,
    options,
  );
}

beforeEach(() => {
  saved.blobs.length = 0;
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  restoreWideScreen();
  vi.restoreAllMocks();
});

describe('the Cannibalization screen', () => {
  it('shows the strip with changes, the conflicts by default and the text alternative of a history strip', async () => {
    const { asked } = serve();
    const { container } = render();
    // Six figures; the change against the period before is shown where the API has one
    expect(await screen.findByLabelText(/^Keywords with a conflict: 2, −2\. /)).toBeVisible();
    expect(screen.getByLabelText(/^Co-ranking: 1\. /)).toBeVisible();
    const table = await screen.findByRole('table', { name: 'Keywords where more than one of your pages competes' });
    expect(within(table).getByRole('button', { name: 'Open alpha' })).toBeVisible();
    expect(within(table).getByRole('button', { name: 'Open beta' })).toBeVisible();
    // gamma has no conflict, zeta is too early to judge
    expect(within(table).queryByRole('button', { name: 'Open gamma' })).toBeNull();
    expect(
      within(table).getByRole('img', {
        name: 'Ranking page on each of the last 3 checks: A /a 2, B /b 1. 0 switches',
      }),
    ).toBeVisible();
    expect(within(table).getByText('Not the target page')).toBeInTheDocument();
    expect(
      screen.getByText('1 keyword too early to judge (fewer than 10 ranked checks)', { exact: false }),
    ).toBeVisible();
    // the scope is sent as the address holds it: 30 days, desktop, every keyword
    const query = asked[0]?.searchParams;
    expect(query?.get('days')).toBe('30');
    expect(query?.get('device')).toBe('desktop');
    expect(query?.get('verdict')).toBe('all');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows every ranked keyword for All keywords, and the page pairs for that view', async () => {
    serve();
    const { user } = render({ searchParams: 'show=all' });
    const table = await screen.findByRole('table', { name: /Keywords where more than one/ });
    expect(within(table).getByRole('button', { name: 'Open gamma' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'By page pair' }));
    const pairs = await screen.findByRole('table', { name: 'Pairs of your pages that compete' });
    expect(within(pairs).getByRole('button', { name: 'Show the keywords of /a and /b' })).toBeVisible();
  });

  it('shows the Switching tab with its strip, chart and changes', async () => {
    serve();
    render({ searchParams: '' }, { tab: 'switching' });
    expect(await screen.findByLabelText(/^Confirmed switches: 2\. /)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Switches per week' })).toBeVisible();
    const table = await screen.findByRole('table', { name: 'Confirmed switches of the ranking page' });
    expect(within(table).getAllByRole('button', { name: /^Open / })).toHaveLength(2);
    expect(within(table).getByText('Left the target')).toBeVisible();
  });

  it('says there is nothing to judge for a project with no tracked keywords', async () => {
    server.use(http.get(BASE, () => HttpResponse.json({ data: cannConflicts([]) })));
    server.use(http.get(`${BASE}/switches`, () => HttpResponse.json({ data: cannSwitches([]) })));
    render();
    expect(await screen.findByRole('heading', { name: 'No tracked keywords yet' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to Keywords' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/seo/keywords',
    );
  });

  it('shows an error with Try again when the read fails', async () => {
    server.use(http.get(BASE, ({ request }) => problem(request, 'internal_error')));
    server.use(http.get(`${BASE}/switches`, () => HttpResponse.json({ data: cannSwitches([]) })));
    render();
    expect((await screen.findAllByText('Could not load cannibalization'))[0]).toBeVisible();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Try again' })[0]).toBeVisible());
  });
});

describe('the Cannibalization screen: export, widths, period notes and the live numbers', () => {
  it('saves the table in view as CSV, says how many rows, and says when the read stopped short', async () => {
    server.use(
      http.get(BASE, () =>
        HttpResponse.json({
          data: { ...cannConflicts(KEYWORDS), meta: { ...cannConflicts(KEYWORDS).meta, total: 812 } },
        }),
      ),
      http.get(`${BASE}/pairs`, () => HttpResponse.json({ data: cannPairs() })),
      http.get(`${BASE}/switches`, () => HttpResponse.json({ data: cannSwitches([]) })),
    );
    const { user } = render();
    await screen.findByRole('table', { name: /Keywords where more than one/ });
    expect(screen.getByText('Showing the first 4 of 812 keywords')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Export this table as CSV' }));
    expect(saved.blobs).toHaveLength(1);
    expect(saved.blobs[0]?.name).toBe('cannibalization-keywords-desktop-30d-2026-11-26.csv');
    const text = await saved.blobs[0]?.blob.text();
    expect(text).toContain('Keyword,Status,Pages,Rank,Rank gap (places)');
    expect(text).toContain('alpha,Likely cannibalization');
    expect(text).not.toContain('gamma');
    expect(screen.getByText(/^Exported 2 rows/)).toHaveTextContent(
      'Exported 2 rows as cannibalization-keywords-desktop-30d-2026-11-26.csv. The page read the first 4 of 812 keywords, so the file does not hold the rest.',
    );
  });

  it('puts the date range of each period under its option', async () => {
    serve();
    const { user } = render();
    await screen.findByRole('table', { name: /Keywords where more than one/ });
    await user.click(screen.getByRole('combobox', { name: 'Period: Last 30 days' }));
    expect(await screen.findByText('Oct 28 to Nov 26, 2026')).toBeVisible();
    expect(screen.getByText('Nov 13 to Nov 26, 2026')).toBeVisible();
  });

  it('shows the short status word and keeps the full name for a screen reader', async () => {
    serve();
    render();
    const table = await screen.findByRole('table', { name: /Keywords where more than one/ });
    expect(within(table).getAllByText('Likely cannibalization', { selector: '.sr-only' }).length).toBeGreaterThan(0);
  });

  it('offers Reset column widths only while a column differs, and takes it back', async () => {
    serve();
    const { user } = render();
    const table = await screen.findByRole('table', { name: /Keywords where more than one/ });
    expect(screen.queryByRole('button', { name: 'Reset column widths' })).toBeNull();
    const rank = within(table).getByRole('separator', { name: 'Resize the Rank column' });
    rank.focus();
    await user.keyboard('{ArrowRight}');
    expect(rank).toHaveAttribute('aria-valuenow', '80');
    await user.click(await screen.findByRole('button', { name: 'Reset column widths' }));
    expect(within(table).getByRole('separator', { name: 'Resize the Rank column' })).toHaveAttribute(
      'aria-valuenow',
      '64',
    );
    expect(screen.queryByRole('button', { name: 'Reset column widths' })).toBeNull();
  });

  it('carries this period numbers in the strip tooltips', async () => {
    serve();
    render();
    expect(
      await screen.findByLabelText(/^Keywords with a conflict: 2, .*2 of 3 ranked keywords have a conflict\./),
    ).toBeVisible();
  });

  it('names what a switch did to the target page, and says it is not ranked rather than n/a', async () => {
    server.use(
      http.get(BASE, () =>
        HttpResponse.json({
          data: cannConflicts([
            cannKeyword('alpha', 'likely', { target_url_id: 'b' }),
            cannKeyword('beta', 'likely', { target_url_id: null, current_rank: null }),
          ]),
        }),
      ),
      http.get(`${BASE}/pairs`, () => HttpResponse.json({ data: cannPairs() })),
      http.get(`${BASE}/switches`, () =>
        HttpResponse.json({ data: cannSwitches([cannSwitchRow('alpha'), cannSwitchRow('beta')]) }),
      ),
    );
    render({ searchParams: '' }, { tab: 'switching' });
    const table = await screen.findByRole('table', { name: 'Confirmed switches of the ranking page' });
    expect(within(table).getByText('Back on target')).toBeVisible();
    expect(within(table).getByText('No target set')).toBeVisible();
    expect(
      screen.getByText('The first move of a flip-flop shows as Moved until the page returns.', { exact: false }),
    ).toBeVisible();
    expect(screen.queryByText('n/a')).toBeNull();
  });
});
