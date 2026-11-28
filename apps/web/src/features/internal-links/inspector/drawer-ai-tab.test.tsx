import type { Route } from 'next';
import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DrawerAiTab } from './drawer-ai-tab';
import type { PageDrawerContext } from './page-drawer-context';
import type { PageDetail } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import {
  AI_CITED_PAGE,
  AI_ERROR_PAGE,
  AI_NO_ANSWERS_PAGE,
  AI_NO_PROMPTS_PAGE,
  AI_QUIET_PAGE,
  pageAiOf,
} from '@/mocks/internal-links-page-ai';
import { EVENTUS } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

const PAGE_AI_PATH = mswPath(
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/ai',
);

const CONTEXT = (overrides: Partial<PageDrawerContext> = {}): PageDrawerContext => ({
  scope: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id },
  workspaceSlug: MOCK_WORKSPACE.slug,
  projectSlug: 'eventus-security',
  crawl: { crawl: null, run: null, older: false, linksAvailable: true, unknown: false },
  linkScope: 'editorial',
  tiers: [],
  timeZone: 'UTC',
  canWrite: false,
  canNote: false,
  openPage: vi.fn(),
  openPrompt: vi.fn(),
  hrefs: {
    journey: () => '/journey' as Route,
    linksFrom: () => '/from' as Route,
    linksTo: () => '/to' as Route,
    issueCheck: () => null,
    taxonomy: '/taxonomy' as Route,
    integrations: '/integrations' as Route,
  },
  ...overrides,
});

const DETAIL = (total = 10): PageDetail =>
  ({
    extras: {
      citations: { chatgpt: 5, gemini: 3, ai_mode: total === 0 ? 0 : 2, total, citations_as_of: '2026-11-18' },
    },
  }) as unknown as PageDetail;

const STRIP = <section aria-label="Citations strip stub">Citations strip</section>;

function renderTab(urlId: string, context = CONTEXT(), detail: PageDetail | null = DETAIL()) {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return {
    context,
    ...renderWithProviders(<DrawerAiTab context={context} urlId={urlId} detail={detail} citations={STRIP} />),
  };
}

afterEach(() => {
  server.resetHandlers();
});

describe('DrawerAiTab', () => {
  it('renders the strip, period dates, the three cards in order, and basis note for a cited page', async () => {
    const context = CONTEXT();
    renderTab(AI_CITED_PAGE, context);

    expect(screen.getByText('Citations strip')).toBeInTheDocument();
    expect(await screen.findByText('Oct 22, 2026 to Nov 18, 2026, project days')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prompts that cited this page' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Citations over time' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cited with this page' })).toBeInTheDocument();
    expect(screen.getByText(/against Sep 24, 2026 to Oct 21, 2026/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'These cards count answers of the prompts you track now (not paused or archived) on ChatGPT, Gemini and Google AI Mode. The number above counts every answer of the last 28 days, including Google AI Overview and paused or archived prompts, so it can be higher.',
      ),
    ).toBeInTheDocument();

    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual(['Prompts that cited this page', 'Citations over time', 'Cited with this page']);
  });

  it('wires prompt clicks to openPrompt with row ids and own in-crawl alongside clicks to openPage', async () => {
    const context = CONTEXT();
    const { user } = renderTab(AI_CITED_PAGE, context);

    const promptsTable = await screen.findByRole('table', { name: 'Prompts that cited this page' });
    const promptButtons = within(promptsTable).getAllByRole('button');
    const firstPrompt = promptButtons[0];
    if (firstPrompt === undefined) throw new Error('Expected prompt button');
    await user.click(firstPrompt);
    expect(context.openPrompt).toHaveBeenCalledTimes(1);
    const [promptId, order] = vi.mocked(context.openPrompt).mock.calls[0] ?? [];
    expect(typeof promptId).toBe('string');
    expect(order).toHaveLength(6);

    const alongsideTable = screen.getByRole('table', { name: 'Other addresses cited in the same answers' });
    const ownButton = within(alongsideTable).getAllByRole('button')[0];
    if (ownButton === undefined) throw new Error('Expected own alongside page button');
    await user.click(ownButton);
    expect(context.openPage).toHaveBeenCalledWith('103');
  });

  it('shows the empty strip sentence, empty card states and zeroed trend for a quiet ready page', async () => {
    renderTab(AI_QUIET_PAGE, CONTEXT(), DETAIL(0));

    expect(screen.getByText('No AI answer cited this page in the last 28 days')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'No prompt cited this page in this period' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Not cited in this period')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No other address was cited in the same answers' })).toBeInTheDocument();
  });

  it('shows one EmptyState and no cards for no_answers and no_prompts states', async () => {
    const first = renderTab(AI_NO_ANSWERS_PAGE, CONTEXT(), DETAIL(0));
    expect(await screen.findByRole('heading', { name: 'No answers in this period' })).toBeInTheDocument();
    expect(screen.getByText('Your prompts have not been answered in the last 28 days.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Prompts that cited this page' })).toBeNull();
    first.unmount();

    renderTab(AI_NO_PROMPTS_PAGE, CONTEXT(), DETAIL(0));
    expect(await screen.findByRole('heading', { name: 'No prompts are tracked yet' })).toBeInTheDocument();
    expect(
      screen.getByText('Add prompts and run them to see which of your pages the answers cite.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Citations over time' })).toBeNull();
  });

  it('shows one InlineError on failure and refetches on Retry', async () => {
    const { user } = renderTab(AI_ERROR_PAGE);

    expect(await screen.findByText('The AI citations of this page could not be loaded')).toBeInTheDocument();

    server.use(
      http.get(PAGE_AI_PATH, () =>
        HttpResponse.json({ data: pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Oct 22, 2026 to Nov 18, 2026, project days')).toBeInTheDocument();
  });

  it('shows card skeletons while loading and mounts no chart', async () => {
    server.use(
      http.get(PAGE_AI_PATH, async () => {
        await delay('infinite');
        return HttpResponse.json({ data: pageAiOf(AI_CITED_PAGE) });
      }),
    );
    const { container } = renderTab(AI_CITED_PAGE);

    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId('echart-canvas')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
