import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

import { schedule } from '@/features/ai-overview/cards/activity/model/activity-fixtures';
import { PromptsScreen, type PromptsProject } from '@/features/prompts/prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { setAiSeeded } from '@/mocks/ai-seed';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender, type ProvidedRenderOptions } from '@/test/render';

/*
 * What the tests of the Topics & Prompts header share (WP-17 plan section 4): the page for a signed-in role on
 * Fynix (24 prompts) or Eventus Security (72 prompts, every facet varied), a render that records the URL
 * writes, and the schedules the cadence line reads. Not a test file. It mocks nothing: the test file keeps its
 * own `vi.mock('next/navigation', ...)`, `vi.mock('@/components/app/chart/echart', ...)` and the
 * `@/test/topic-drawer-harness` import, as `row-menu.test.tsx` does.
 *
 * It lives in `src/test` (not in `features/prompts/header`, as the plan names it) because it reads the
 * Overview's fixtures and harness, which a feature may not import.
 */

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
export const NOW = new Date('2026-11-12T12:00:00Z');

export const FYNIX: PromptsProject = overviewProject('fynix');
export const EVENTUS: PromptsProject = overviewProject('eventus-security');

export type PromptsWorld = 'fynix' | 'eventus';

/** Fixes the clock at `NOW` and the viewport at a wide screen for every test of the file. Call it once at the top. */
export function installPromptsClock(): void {
  beforeEach(() => {
    vi.setSystemTime(NOW);
    stubWideScreen();
  });
  afterEach(() => {
    vi.useRealTimers();
    restoreWideScreen();
  });
}

/** The page for a member of `role` (signed in through the mock session cookie) on a project. */
export function promptsAs(role: Role, project: PromptsProject = FYNIX): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
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

/** One URL write the page made, as the testing adapter reports it. */
export interface UrlWrite {
  queryString: string;
  history: string | undefined;
}

export interface PromptsRenderOptions {
  /** The query string the page starts with, such as `?tab=prompts&intent=commercial`. */
  search?: string;
  role?: Role;
  project?: PromptsWorld;
  onUrlUpdate?: ProvidedRenderOptions['onUrlUpdate'];
}

/** Renders the page; `writes` holds every URL change it makes, in order. Eventus turns its data set on first. */
export function renderPrompts({
  search = '',
  role = 'viewer',
  project = 'fynix',
  onUrlUpdate,
}: PromptsRenderOptions = {}): ProvidedRender & { writes: UrlWrite[] } {
  if (project === 'eventus') setAiSeeded(true);
  const writes: UrlWrite[] = [];
  const options: ProvidedRenderOptions = {
    searchParams: search,
    onUrlUpdate: (update) => {
      writes.push({ queryString: update.queryString, history: update.options.history });
      onUrlUpdate?.(update);
    },
  };
  return { ...renderWithProviders(promptsAs(role, project === 'eventus' ? EVENTUS : FYNIX), options), writes };
}

/**
 * What the project's AI schedules answer: weekly schedules on these weekdays (1 is Monday), `'paused'` for two
 * paused ones, `'none'` for no schedule, `'fail'` for a server error.
 */
export type ScheduleServing = readonly number[] | 'paused' | 'none' | 'fail';

const SCHEDULES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/schedules');

export function serveSchedules(serving: ScheduleServing): void {
  if (serving === 'fail') {
    server.use(
      http.get(SCHEDULES, () =>
        HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 }),
      ),
    );
    return;
  }
  const rows =
    serving === 'none'
      ? []
      : serving === 'paused'
        ? [schedule({ n: 1, weekday: 1, active: false }), schedule({ n: 2, weekday: 4, active: false })]
        : serving.map((weekday, index) => schedule({ n: index + 1, weekday }));
  server.use(
    http.get(SCHEDULES, () =>
      HttpResponse.json({ data: rows, page: { offset: 0, limit: rows.length, total: rows.length }, meta: {} }),
    ),
  );
}
