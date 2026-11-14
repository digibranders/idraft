import { http, HttpResponse } from 'msw';

import type { Run } from '@/lib/api/types';
import type { AiRunsScope } from '@/lib/runs/ai-reads';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';

/** What the tests of the collection line and of the Updated link share: a run, and a project's runs route that answers one. */

const RUNS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');

export const RUNS_SCOPE: AiRunsScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
export const WORKSPACE_SLUG = MOCK_WORKSPACE.slug;
export const PROJECT_SLUG = fynix.slug;
export const PROJECT_TIME_ZONE = 'Europe/Berlin';

/** A run that ended at 05:12 UTC (06:12 in Berlin) on 14 November 2026 with 141 of 150 AI answers. */
export function runFixture(over: Partial<Run> = {}): Run {
  return {
    run_id: '0192d1a8-aaaa-7b44-8c2d-1f0e9d8c7b01',
    project_id: RUNS_SCOPE.projectId,
    schedule_id: null,
    workload: 'ai_prompt',
    trigger: 'schedule',
    status: 'completed',
    status_reason: null,
    window_start: '2026-11-14T05:00:00Z',
    window_end: '2026-11-14T06:00:00Z',
    tasks_total: 150,
    tasks_succeeded: 141,
    tasks_failed: 9,
    estimated_cost_usd: '1.50',
    actual_cost_usd: '1.41',
    blocked_by_budget_id: null,
    created_by: null,
    created_at: '2026-11-14T05:00:00Z',
    completed_at: '2026-11-14T05:12:00Z',
    operation: {
      kind: 'collection_run',
      status: 'succeeded',
      progress: { done: 150, total: 150, unit: 'tasks' },
      started_at: '2026-11-14T05:00:00Z',
      finished_at: '2026-11-14T05:12:00Z',
      error: null,
      links: { self: '/api/v1/runs/0192d1a8-aaaa-7b44-8c2d-1f0e9d8c7b01' },
    },
    ...over,
  };
}

export interface ServedRuns {
  /** The query of every request the route has had, in order. */
  queries: URLSearchParams[];
}

/**
 * Answers the project's runs list from `answer`, which gets the request's query and returns the runs of the
 * page, or `null` for a server error.
 */
export function serveRuns(answer: (query: URLSearchParams) => readonly Run[] | null): ServedRuns {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(mswPath(RUNS), ({ request }) => {
      const query = new URL(request.url).searchParams;
      queries.push(query);
      const runs = answer(query);
      if (runs === null) {
        return HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 });
      }
      return HttpResponse.json({
        data: runs,
        page: { has_more: false, next_cursor: null, limit: 1 },
        meta: { manual_runs_today: { used: 0, limit: 20 } },
      });
    }),
  );
  return { queries };
}

const ENGINES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines';

/** Answers the project's engines read with these labels, by engine code: what `useEngineNames` shows. */
export function serveEngineNames(labels: Readonly<Record<string, string>>): void {
  server.use(
    http.get(mswPath(ENGINES), () =>
      HttpResponse.json({
        data: Object.entries(labels).map(([code, label]) => ({
          active_prompts: 3,
          engine: {
            engine_code: code,
            exposes_citations: true,
            exposes_fanout: false,
            label,
            max_prompt_chars: 2000,
            observation_class: 'consumer_ui',
            vendor: 'Vendor',
          },
          estimated_monthly_cost_usd: null,
          is_configured: true,
          is_enabled: true,
          location_ids: [],
          provider_code: 'dataforseo',
          replicates: 1,
        })),
      }),
    ),
  );
}
