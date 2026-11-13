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
import { runFixture, serveRuns } from '@/test/ai-runs-harness';
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

/** Thursday 12 November 2026, noon UTC: the 10:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const SUMMARY = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');
const RUN_ID = '0192d1a8-cccc-7b44-8c2d-1f0e9d8c7b03';

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

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  // One prompt whose newest answer was read at 10:00, so the page says "Updated 2h ago"
  server.use(
    http.get(SUMMARY, () =>
      HttpResponse.json({
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
      }),
    ),
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

describe('Topics & Prompts Updated text', () => {
  it('Topics and Prompts shows Updated as a link to the newest finished AI run', async () => {
    serveRuns(() => [runFixture({ run_id: RUN_ID, project_id: project.id })]);
    renderWithProviders(promptsAsViewer());
    // The toolbar's own text, now a link to the Runs page of the project with that run open
    const link = await screen.findByRole('link', { name: /^Updated 2h ago/ });
    expect(link).toHaveTextContent('Updated 2h ago');
    expect(link).toHaveAttribute('href', `/digibranders/fynix/ops/runs?inspect=run%3A${RUN_ID}`);
  });

  it('keeps Updated as plain text while the project has no finished AI run', async () => {
    const served = serveRuns(() => []);
    renderWithProviders(promptsAsViewer());
    expect(await screen.findByText('Updated 2h ago')).toBeVisible();
    await waitFor(() => expect(served.queries.length).toBeGreaterThan(0));
    expect(screen.queryByRole('link', { name: /^Updated/ })).toBeNull();
  });
});
