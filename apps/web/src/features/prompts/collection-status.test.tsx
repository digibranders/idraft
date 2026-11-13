import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen, type PromptsProject } from './prompts-screen';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { NO_COUNTS, promptCells } from '@/mocks/prompt-summary';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { runFixture, serveEngineNames, serveRuns } from '@/test/ai-runs-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';
// A topic drawer reads the entities and the tracked keywords: the harness answers both with none
import '@/test/topic-drawer-harness';

// jsdom has no canvas: a topic drawer's charts are drawn as an empty box
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

/** Thursday 12 November 2026, noon UTC. */
const NOW = new Date('2026-11-12T12:00:00Z');
const SUMMARY = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');
const COVERAGE = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs/{run_id}/ai-coverage');
const OPEN_ID = '0192d1a8-aaaa-7b44-8c2d-1f0e9d8c7b0a';
/** The page opens on Topics: the Prompts tab is what a link to it opens. */
const PROMPTS_TAB = 'tab=prompts';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const project: PromptsProject = {
  id: fynix.project_id,
  slug: fynix.slug,
  name: fynix.name,
  timeZone: fynix.timezone,
  defaultLanguage: 'en',
  defaultCountryIso: 'DE',
};

let summaryReads = 0;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  stubWideScreen();
  summaryReads = 0;
  serveEngineNames({ chatgpt_web: 'ChatGPT' });
  server.use(
    http.get(SUMMARY, () => {
      summaryReads += 1;
      return HttpResponse.json({
        data: {
          window: { from: '2026-10-16', to: '2026-11-12', timezone: fynix.timezone },
          include_branded: false,
          engine_codes: ['chatgpt_web'],
          prompts: [
            {
              prompt_id: '11111111-0000-4000-8000-000000000001',
              text: 'Question number 1?',
              is_branded: false,
              topic_term_ids: [],
              last_observed_at: '2026-11-12T10:00:00Z',
              last_valid_at: '2026-11-12T10:00:00Z',
              engines: [promptCells('chatgpt_web', NO_COUNTS)],
            },
          ],
          topics: [],
        },
      });
    }),
    // A finished run of the project is not the subject here: its coverage is healthy
    http.get(COVERAGE, () => HttpResponse.json({ data: { by_engine: [], missing: [] } })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAsViewer(): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory('viewer')}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={project}
        />
      </Suspense>
    </PermissionProvider>
  );
}

describe('Topics & Prompts collection status', () => {
  it('Topics and Prompts shows the progress above the table and refreshes the summary when the run ends', async () => {
    let open = true;
    serveRuns((query) => {
      if (query.get('filter[status_in]')?.includes('planned') !== true) return [];
      return open
        ? [
            runFixture({
              run_id: OPEN_ID,
              project_id: project.id,
              status: 'running',
              tasks_total: 1000,
              tasks_succeeded: 409,
              tasks_failed: 3,
              completed_at: null,
            }),
          ]
        : [];
    });
    renderWithProviders(promptsAsViewer(), { searchParams: PROMPTS_TAB });

    // The line is above the table, and links to the run
    const line = await screen.findByText('Collecting answers: 412 of 1,000 tasks, 3 failed');
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    expect(line.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View run' })).toHaveAttribute(
      'href',
      `/digibranders/fynix/ops/runs?inspect=run%3A${OPEN_ID}`,
    );

    // The run ends: the line goes, and the page reads the summary again so the table shows the new answers
    await waitFor(() => expect(summaryReads).toBeGreaterThan(0));
    const before = summaryReads;
    open = false;
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(screen.queryByText(/^Collecting answers/)).toBeNull());
    await waitFor(() => expect(summaryReads).toBeGreaterThan(before));
    expect(await screen.findByRole('grid', { name: 'Prompts' })).toBeVisible();
  });

  it('shows no progress line and no notice while no AI run is open and the last one was healthy', async () => {
    const served = serveRuns(() => []);
    renderWithProviders(promptsAsViewer(), { searchParams: PROMPTS_TAB });
    await screen.findByRole('grid', { name: 'Prompts' });
    await waitFor(() => expect(served.queries.length).toBeGreaterThan(1));
    expect(screen.queryByText(/^Collecting answers/)).toBeNull();
    expect(screen.queryByText(/is degraded in the latest run/)).toBeNull();
  });
});
