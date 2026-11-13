import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiCollectionStatus } from './ai-collection-status';
import type { Role, Run, Schemas } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import {
  PROJECT_SLUG,
  RUNS_SCOPE,
  WORKSPACE_SLUG,
  runFixture,
  serveEngineNames,
  serveRuns,
} from '@/test/ai-runs-harness';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const COVERAGE = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/runs/{run_id}/ai-coverage');
const ENGINES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines');

const OPEN_ID = '0192d1a8-aaaa-7b44-8c2d-1f0e9d8c7b0a';
const NEW_ID = '0192d1a8-bbbb-7b44-8c2d-1f0e9d8c7b0b';
const OLD_ID = '0192d1a8-cccc-7b44-8c2d-1f0e9d8c7b0c';

type EngineRow = Schemas['AiCoverageEngine'];

const engineRow = (engine_code: EngineRow['engine_code'], valid: number, planned = 150): EngineRow => ({
  engine_code,
  planned,
  observed: valid,
  valid,
  partial: 0,
  invalid_by_status: { empty: planned - valid, refused: 0, error: 0 },
  valid_rate: { numerator: valid, denominator: planned, n_observations: valid, value: valid / planned },
});

/** The run an open collection is: 412 of 1,000 tasks ended, 3 of them failed. */
const openRun = (over: Partial<Run> = {}): Run =>
  runFixture({
    run_id: OPEN_ID,
    status: 'running',
    tasks_total: 1000,
    tasks_succeeded: 409,
    tasks_failed: 3,
    completed_at: null,
    ...over,
  });

const isOpenQuery = (query: URLSearchParams): boolean => query.get('filter[status_in]')?.includes('planned') === true;

interface World {
  /** The open run the route answers now; `null` for none. */
  open: Run | null;
  /** The newest finished AI run the route answers now; `null` for none. */
  finished: Run | null;
}

/** Answers the two runs reads of the connector from `world`, which a test changes while the component is on screen. */
function serveWorld(world: World): ReturnType<typeof serveRuns> {
  return serveRuns((query) => {
    const run = isOpenQuery(query) ? world.open : world.finished;
    return run === null ? [] : [run];
  });
}

interface ServedCoverage {
  /** The run ids the coverage route has been asked for, in order. */
  asked: string[];
}

/** Answers the coverage route per run id from `byRun`; a run not in it, or `null`, is a server error. */
function serveCoverage(byRun: Readonly<Record<string, readonly EngineRow[] | null>>): ServedCoverage {
  const served: ServedCoverage = { asked: [] };
  server.use(
    http.get(COVERAGE, ({ params }) => {
      const runId = String(params['run_id']);
      served.asked.push(runId);
      const engines = byRun[runId];
      return engines === undefined || engines === null
        ? HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 })
        : HttpResponse.json({ data: { by_engine: engines, missing: [] } });
    }),
  );
  return served;
}

const NAMES = { chatgpt_web: 'ChatGPT', gemini_web: 'Gemini', google_ai_mode: 'Google AI Mode' };

function statusAs(role: Role, onFinished: () => void = vi.fn()): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <AiCollectionStatus
        scope={RUNS_SCOPE}
        workspaceSlug={WORKSPACE_SLUG}
        projectSlug={PROJECT_SLUG}
        onFinished={onFinished}
      />
    </PermissionProvider>
  );
}

const runHref = (id: string): string => `/${WORKSPACE_SLUG}/${PROJECT_SLUG}/ops/runs?inspect=run%3A${id}`;
const polite = (): HTMLElement | null => document.getElementById('live-region-polite');

beforeEach(() => {
  serveEngineNames(NAMES);
});

describe('AiCollectionStatus progress', () => {
  it('progress shows the counts of an open AI run in a compact line', async () => {
    const served = serveWorld({ open: openRun(), finished: null });
    renderWithProviders(statusAs('viewer'));
    expect(await screen.findByText('Collecting answers: 412 of 1,000 tasks, 3 failed')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View run' })).toHaveAttribute('href', runHref(OPEN_ID));
    // It asks for the project's open AI runs, planned or running, and for one only
    const openQuery = served.queries.find(isOpenQuery);
    expect(openQuery?.get('filter[workload_in]')).toBe('ai_prompt');
    expect(openQuery?.get('filter[status_in]')).toBe('planned,running');
    expect(openQuery?.get('limit')).toBe('1');
  });

  it('shows a planned run as collecting, from its own counts', async () => {
    serveWorld({ open: openRun({ status: 'planned', tasks_succeeded: 0, tasks_failed: 0 }), finished: null });
    renderWithProviders(statusAs('viewer'));
    expect(await screen.findByText('Collecting answers: 0 of 1,000 tasks')).toBeVisible();
  });

  it('progress is absent when no AI run is open', async () => {
    const served = serveWorld({ open: null, finished: null });
    const { container } = renderWithProviders(statusAs('viewer'));
    await waitFor(() => expect(served.queries.length).toBeGreaterThan(1));
    await waitFor(() => expect(container.querySelector('[data-slot="ai-collection-status"]')).toBeNull());
    expect(screen.queryByText(/^Collecting answers/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'View run' })).toBeNull();
  });

  it('ignores an open run of another workload, whatever the server sent', async () => {
    const served = serveWorld({ open: openRun({ workload: 'keyword_metrics' }), finished: null });
    renderWithProviders(statusAs('viewer'));
    await waitFor(() => expect(served.queries.length).toBeGreaterThan(1));
    expect(screen.queryByText(/^Collecting answers/)).toBeNull();
  });

  describe('over time', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('progress announces the finish once and calls onFinished', async () => {
      const world: World = { open: openRun(), finished: null };
      serveWorld(world);
      const onFinished = vi.fn();
      renderWithProviders(statusAs('viewer', onFinished));
      await screen.findByText('Collecting answers: 412 of 1,000 tasks, 3 failed');
      expect(onFinished).not.toHaveBeenCalled();
      expect(polite()).toHaveTextContent('');

      // The run ends: the next poll finds no open run, and the page is told once
      world.open = null;
      world.finished = openRun({ status: 'completed', completed_at: '2026-11-14T05:12:00Z' });
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('Collection finished')).toBeInTheDocument();
      expect(polite()).toHaveTextContent('Collection finished');
      expect(screen.queryByText(/^Collecting answers/)).toBeNull();

      // Later polls and re-renders say nothing more
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it('does not announce a finish for a run it never saw open', async () => {
      const served = serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID }) });
      const onFinished = vi.fn();
      renderWithProviders(statusAs('viewer', onFinished));
      await waitFor(() => expect(served.queries.length).toBeGreaterThan(1));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onFinished).not.toHaveBeenCalled();
      expect(polite()).toHaveTextContent('');
    });

    it('progress polls every 10 seconds only while a run is open', async () => {
      const world: World = { open: openRun(), finished: null };
      const served = serveWorld(world);
      const opens = (): number => served.queries.filter(isOpenQuery).length;
      renderWithProviders(statusAs('viewer'));
      await screen.findByText('Collecting answers: 412 of 1,000 tasks, 3 failed');
      expect(opens()).toBe(1);

      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(opens()).toBe(2));
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(opens()).toBe(3));

      // It ends: one more read sees that, and then the project's runs are not polled for open ones at all
      world.open = null;
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(screen.queryByText(/^Collecting answers/)).toBeNull());
      const settled = opens();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(opens()).toBe(settled);
    });

    it('does not poll at all when no run is open', async () => {
      const served = serveWorld({ open: null, finished: null });
      renderWithProviders(statusAs('viewer'));
      await waitFor(() => expect(served.queries.some(isOpenQuery)).toBe(true));
      const first = served.queries.filter(isOpenQuery).length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(served.queries.filter(isOpenQuery)).toHaveLength(first);
    });
  });
});

describe('AiCollectionStatus notice', () => {
  it('the notice names each degraded engine with its counts and links to the run', async () => {
    serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID }) });
    serveCoverage({
      [NEW_ID]: [engineRow('chatgpt_web', 147), engineRow('gemini_web', 132), engineRow('google_ai_mode', 90, 100)],
    });
    renderWithProviders(statusAs('viewer'));
    expect(
      await screen.findByText(
        'Gemini: 132 of 150 answers valid, 88%. Below 90%, so this engine is degraded in the latest run.',
      ),
    ).toBeVisible();
    // Exactly 90 percent (90 of 100) is not degraded, and the healthy engine is not named
    expect(screen.queryByText(/^Google AI Mode:/)).toBeNull();
    expect(screen.queryByText(/^ChatGPT:/)).toBeNull();
    expect(screen.getByRole('link', { name: 'View run for Gemini' })).toHaveAttribute('href', runHref(NEW_ID));
  });

  it('judges each engine alone: a healthy pooled rate does not hide a degraded engine', async () => {
    serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID }) });
    // 147 + 132 + 150 of 450 is 95 percent pooled
    serveCoverage({
      [NEW_ID]: [engineRow('chatgpt_web', 147), engineRow('gemini_web', 132), engineRow('google_ai_mode', 150)],
    });
    renderWithProviders(statusAs('viewer'));
    expect(await screen.findByText(/^Gemini: 132 of 150/)).toBeVisible();
    expect(screen.getAllByRole('link', { name: /^View run for/ })).toHaveLength(1);
  });

  it('shows the code of an engine the engines read does not name, never a blank', async () => {
    serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID }) });
    serveCoverage({ [NEW_ID]: [engineRow('gemini_web', 100)] });
    serveEngineNames({});
    renderWithProviders(statusAs('viewer'));
    expect(await screen.findByText(/^gemini_web: 100 of 150/)).toBeVisible();
  });

  it('the notice is a warning banner that is read with the page, not a live alert', async () => {
    serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID }) });
    serveCoverage({ [NEW_ID]: [engineRow('gemini_web', 132)] });
    const { container } = renderWithProviders(statusAs('viewer'));
    await screen.findByText(/^Gemini: 132 of 150/);
    const banner = container.querySelector('[data-slot="banner"]');
    expect(banner).toHaveClass('border-warning-border');
    expect(banner).not.toHaveAttribute('role');
  });

  it('shows no notice when every engine is healthy', async () => {
    const served = serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID }) });
    const coverage = serveCoverage({ [NEW_ID]: [engineRow('chatgpt_web', 147), engineRow('gemini_web', 141)] });
    const { container } = renderWithProviders(statusAs('viewer'));
    await waitFor(() => expect(coverage.asked).toContain(NEW_ID));
    await waitFor(() => expect(served.queries.length).toBeGreaterThan(1));
    await waitFor(() => expect(renderedIdle(container)).toBe(true));
  });

  it('the newest finished run decides, an older bad run does not', async () => {
    // The route answers the newest finished run only (limit 1): the older run is bad, and is never asked about
    const served = serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID }) });
    const coverage = serveCoverage({
      [NEW_ID]: [engineRow('gemini_web', 147)],
      [OLD_ID]: [engineRow('gemini_web', 60)],
    });
    const { container } = renderWithProviders(statusAs('viewer'));
    await waitFor(() => expect(coverage.asked).toContain(NEW_ID));
    await waitFor(() => expect(renderedIdle(container)).toBe(true));
    expect(coverage.asked).not.toContain(OLD_ID);
    expect(served.queries.find((query) => !isOpenQuery(query))?.get('limit')).toBe('1');
  });

  it('judges the run that finished with errors too', async () => {
    serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID, status: 'completed_with_errors' }) });
    serveCoverage({ [NEW_ID]: [engineRow('gemini_web', 132)] });
    renderWithProviders(statusAs('viewer'));
    expect(await screen.findByText(/^Gemini: 132 of 150/)).toBeVisible();
  });

  it('no notice for a reader without data:read', async () => {
    const served = serveWorld({ open: openRun(), finished: runFixture({ run_id: NEW_ID }) });
    const coverage = serveCoverage({ [NEW_ID]: [engineRow('gemini_web', 132)] });
    let engineReads = 0;
    server.use(
      http.get(ENGINES, () => {
        engineReads += 1;
        return HttpResponse.json({ data: [] });
      }),
    );
    const { container, queryClient } = renderWithProviders(statusAs('billing'));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(renderedIdle(container)).toBe(true);
    // Not hidden after a refusal: nothing was asked
    expect(served.queries).toHaveLength(0);
    expect(coverage.asked).toHaveLength(0);
    expect(engineReads).toBe(0);
  });

  it('a failed read shows nothing alarming and a Retry in the meta', async () => {
    serveWorld({ open: null, finished: runFixture({ run_id: NEW_ID }) });
    const coverage = serveCoverage({ [NEW_ID]: null });
    const { container, user } = renderWithProviders(statusAs('viewer'));
    expect(await screen.findByText('Answer coverage of the latest run did not load.')).toBeVisible();
    expect(container.querySelector('[data-slot="banner"]')).toBeNull();
    expect(container.querySelector('[data-slot="ai-collection-status"] [role="alert"]')).toBeNull();
    expect(coverage.asked).toHaveLength(1);

    // Retry reads again, and a good answer replaces the line with the notice
    server.use(
      http.get(COVERAGE, () => HttpResponse.json({ data: { by_engine: [engineRow('gemini_web', 132)], missing: [] } })),
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/^Gemini: 132 of 150/)).toBeVisible();
    expect(screen.queryByText('Answer coverage of the latest run did not load.')).toBeNull();
  });

  it('passes axe with a progress line and a notice', async () => {
    serveWorld({ open: openRun(), finished: runFixture({ run_id: NEW_ID }) });
    serveCoverage({ [NEW_ID]: [engineRow('gemini_web', 132), engineRow('chatgpt_web', 100)] });
    const { container } = renderWithProviders(statusAs('viewer'));
    await screen.findByText(/^Gemini: 132 of 150/);
    await screen.findByText(/^Collecting answers/);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/** Whether the connector draws nothing: the app's live regions beside it are not its own. */
const renderedIdle = (container: HTMLElement): boolean =>
  container.querySelector('[data-slot="ai-collection-status"]') === null;
