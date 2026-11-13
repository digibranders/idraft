import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAggregates } from './aggregates';
import {
  useOverviewEngines,
  useOverviewFanout,
  useOverviewPeriods,
  useOverviewSchedule,
  useOverviewSources,
  useOverviewSummary,
} from './use-overview-reads';
import type { OverviewReadInput } from './use-overview-reads';
import type { Read } from './read-state';
import type { OverviewScope } from '../scope/scope-model';
import { useLayoutCapabilities } from '@/features/layouts';
import { makeQueryClient } from '@/lib/api/query-client';
import type { EngineCode } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { setAiSeeded } from '@/mocks/ai-seed';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const cleanstart = MOCK_PROJECTS.find((project) => project.slug === 'cleanstart');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || cleanstart === undefined || eventus === undefined) {
  throw new Error('The fixture projects are missing');
}
const refOf = (project: { project_id: string }): { workspaceId: string; projectId: string } => ({
  workspaceId: MOCK_WORKSPACE.workspace_id,
  projectId: project.project_id,
});
const FYNIX = refOf(fynix);
const CLEANSTART = refOf(cleanstart);
const EVENTUS = refOf(eventus);
const PROJECT_PATH = '*/api/v1/workspaces/:w/projects/:p';

function scopeOf(patch: Partial<OverviewScope> = {}): OverviewScope {
  return {
    range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
    rangeValue: { kind: 'preset', preset: '28d' },
    compare: true,
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    ...patch,
  };
}

const inputOf = (
  patch: Partial<OverviewScope> = {},
  enabledEngines: readonly EngineCode[] = ALL,
): OverviewReadInput => ({
  project: FYNIX,
  scope: scopeOf(patch),
  enabledEngines,
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>
    <PermissionProvider membership={membershipFactory('admin')}>{children}</PermissionProvider>
  </QueryClientProvider>
);

/** The requests the server sees from now until the test ends. */
const listeners: ((info: { request: Request }) => void)[] = [];
function recordRequests(): URL[] {
  const seen: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    seen.push(new URL(request.url));
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return seen;
}
const to = (seen: readonly URL[], suffix: string): URL[] => seen.filter((url) => url.pathname.endsWith(suffix));

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(NOW + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe('useOverviewEngines', () => {
  it('is one request when useLayoutCapabilities reads the engines too, under one key', async () => {
    const seen = recordRequests();
    const { result } = renderHook(
      () => ({ layout: useLayoutCapabilities(FYNIX), engines: useOverviewEngines(FYNIX) }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.engines.status).toBe('ready');
      expect(result.current.layout.status).toBe('ready');
    });
    expect(to(seen, '/engines')).toHaveLength(1);
    expect(
      client.getQueryCache().findAll({ queryKey: ['ws', FYNIX.workspaceId, 'p', FYNIX.projectId, 'engines'] }),
    ).toHaveLength(1);
    expect(result.current.engines.enabled).toEqual(result.current.layout.enabledEngines);
    expect(result.current.engines.data).toHaveLength(3);
  });

  it('names no enabled engine for a project with AI off', async () => {
    const { result } = renderHook(() => useOverviewEngines(CLEANSTART), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.enabled).toEqual([]);
  });
});

describe('useOverviewSummary', () => {
  it('reads the summary of the window and the scope', async () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewSummary(inputOf({ engines: ['gemini_web'], country: 'DE' })), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const [request] = to(seen, '/ai/prompts-summary');
    expect(request?.searchParams.get('from')).toBe('2026-10-16');
    expect(request?.searchParams.get('to')).toBe('2026-11-12');
    expect(request?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    expect(request?.searchParams.get('filter[country_iso]')).toBe('DE');
    expect(result.current.data).toBeDefined();
  });

  it('is not asked while no engine is on, and is idle, never loading and never zero', () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewSummary(inputOf({}, [])), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(0);
  });

  it('is not asked when none of the engines chosen is on', () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewSummary(inputOf({ engines: ['gemini_web'] }, ['chatgpt_web'])), {
      wrapper,
    });
    expect(result.current.status).toBe('idle');
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(0);
  });

  it('keeps the last data while a scope change is read, and reports refetching', async () => {
    const { result, rerender } = renderHook(
      (props: { scope: OverviewScope }) =>
        useOverviewSummary({ project: FYNIX, scope: props.scope, enabledEngines: ALL }),
      { wrapper, initialProps: { scope: scopeOf() } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const before = result.current.data;
    expect(before).toBeDefined();
    rerender({ scope: scopeOf({ country: 'DE' }) });
    expect(result.current.status).toBe('refetching');
    expect(result.current.data).toBe(before);
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
  });

  it('reports a failed read as error with its error id, and Retry reads again', async () => {
    server.use(http.get(`${PROJECT_PATH}/ai/prompts-summary`, () => failing('req-summary')));
    const { result } = renderHook(() => useOverviewSummary(inputOf()), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.errorId).toBe('req-summary');
    expect(result.current.data).toBeUndefined();
    expect(result.current.stale).toBe(false);
    server.resetHandlers();
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.errorId).toBeNull();
    expect(result.current.data).toBeDefined();
  });

  it('keeps the data of a read whose refetch failed and marks it stale', async () => {
    const { result } = renderHook(() => useOverviewSummary(inputOf()), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const before = result.current.data;
    server.use(http.get(`${PROJECT_PATH}/ai/prompts-summary`, () => failing('req-again')));
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.stale).toBe(true);
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe(before);
    expect(result.current.errorId).toBe('req-again');
  });
});

describe('useOverviewPeriods', () => {
  it('asks the current window and the previous one with its own from and to', async () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewPeriods(inputOf()), { wrapper });
    await waitFor(() => {
      expect(result.current.current.status).toBe('ready');
      expect(result.current.previous?.status).toBe('ready');
    });
    const asked = to(seen, '/ai/prompts-summary').map(
      (url) => `${url.searchParams.get('from')} ${url.searchParams.get('to')}`,
    );
    expect(asked.sort()).toEqual(['2026-09-18 2026-10-15', '2026-10-16 2026-11-12']);
  });

  it('asks no previous window when the comparison is off', async () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewPeriods(inputOf({ compare: false })), { wrapper });
    await waitFor(() => {
      expect(result.current.current.status).toBe('ready');
    });
    expect(result.current.previous).toBeNull();
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(1);
  });

  it('asks no previous window when it would start before the year 2000', async () => {
    const seen = recordRequests();
    const early = {
      range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
      previous: { from: '1999-12-13', to: '2000-01-09' },
    };
    const { result } = renderHook(() => useOverviewPeriods(inputOf(early)), { wrapper });
    await waitFor(() => {
      expect(result.current.current.status).toBe('ready');
    });
    expect(result.current.previous).toBeNull();
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(1);
  });

  it('is paired and settled when both windows are read, and when the comparison is off', async () => {
    const compared = renderHook(() => useOverviewPeriods(inputOf()), { wrapper });
    expect(compared.result.current).toMatchObject({ paired: false, settled: false });
    await waitFor(() => {
      expect(compared.result.current).toMatchObject({ paired: true, settled: true });
    });
    const off = renderHook(() => useOverviewPeriods(inputOf({ compare: false })), { wrapper });
    await waitFor(() => {
      expect(off.result.current).toMatchObject({ paired: true, settled: true });
    });
  });

  it('is not paired while one window of a scope change has answered and the other has not: no delta between two windows', async () => {
    setAiSeeded(true);
    const enabled: readonly EngineCode[] = ['chatgpt_web', 'gemini_web'];
    const { result, rerender } = renderHook(
      (props: { scope: OverviewScope }) => ({
        periods: useOverviewPeriods({ project: EVENTUS, scope: props.scope, enabledEngines: enabled }),
        engines: useOverviewEngines(EVENTUS),
      }),
      { wrapper, initialProps: { scope: scopeOf() } },
    );
    /** The change of the mention rate on ChatGPT the page would show: the previous window only when paired. */
    const deltaOf = (scope: OverviewScope): number | null => {
      const { periods, engines } = result.current;
      if (periods.current.data === undefined || engines.data === undefined) return null;
      const aggregates = buildAggregates({
        current: periods.current.data,
        previous: periods.paired ? (periods.previous?.data ?? null) : null,
        engines: engines.data,
        chosenEngines: scope.engines,
        topicsKept: null,
        sources: null,
        fanout: null,
      });
      return aggregates.engines[0]?.change.mentioned.delta ?? null;
    };
    await waitFor(() => {
      expect(result.current.periods.paired).toBe(true);
      expect(result.current.engines.status).toBe('ready');
    });
    expect(deltaOf(scopeOf())).not.toBeNull();

    // The previous window answers late: it is held until the current one has settled on the new scope
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${PROJECT_PATH}/ai/prompts-summary`, async ({ request }) => {
        if (new URL(request.url).searchParams.get('to') === '2026-10-15') await gate;
        return undefined;
      }),
    );
    const narrowed = scopeOf({ engines: ['chatgpt_web'] });
    rerender({ scope: narrowed });
    expect(result.current.periods).toMatchObject({ paired: false, settled: false });
    await waitFor(() => {
      expect(result.current.periods.current.status).toBe('ready');
    });
    expect(result.current.periods.previous?.status).toBe('refetching');
    expect(result.current.periods).toMatchObject({ paired: false, settled: false });
    expect(deltaOf(narrowed)).toBeNull();

    release();
    await waitFor(() => {
      expect(result.current.periods).toMatchObject({ paired: true, settled: true });
    });
    expect(deltaOf(narrowed)).not.toBeNull();
  });
});

describe('useOverviewSources', () => {
  it('reads the meta of the sources with the previous period', async () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewSources(inputOf()), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const [request] = to(seen, '/ai/sources/domains');
    expect(request?.searchParams.get('limit')).toBe('1');
    expect(request?.searchParams.get('compare')).toBe('previous_period');
    expect(typeof result.current.data?.citation_units).toBe('number');
  });

  it('is not asked for branded only, which the API cannot narrow sources to', () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewSources(inputOf({ branded: 'only' })), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(to(seen, '/ai/sources/domains')).toHaveLength(0);
  });
});

describe('useOverviewFanout', () => {
  it('reads the fan-out meta of the engines that show it, without an engine filter for all of them', async () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewFanout(inputOf()), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const [request] = to(seen, '/ai/fanout-queries');
    expect(request?.searchParams.get('limit')).toBe('1');
    expect(request?.searchParams.has('filter[engine_code_in]')).toBe(false);
    expect(result.current.data?.engines_without_fanout).toEqual(['gemini_web', 'google_ai_mode']);
    expect(result.current.data?.answers_with_fanout).toBeLessThanOrEqual(result.current.data?.answers ?? -1);
  });

  it('is not asked when no engine in the scope shows its fan-out', async () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewFanout(inputOf({ engines: ['gemini_web'] })), { wrapper });
    // The engines are read first, so the read is not idle on the first render, only once they are known
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(to(seen, '/ai/fanout-queries')).toHaveLength(0);
  });

  it('is not asked for branded only', async () => {
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewFanout(inputOf({ branded: 'only' })), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(to(seen, '/ai/fanout-queries')).toHaveLength(0);
  });
});

describe('useOverviewSchedule', () => {
  it('gives the next run of the AI schedules and that they are not paused', async () => {
    setAiSeeded(true);
    const seen = recordRequests();
    const { result } = renderHook(() => useOverviewSchedule(EVENTUS), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const [request] = to(seen, '/schedules');
    expect(request?.searchParams.get('filter[workload]')).toBe('ai_prompt');
    expect(result.current.data?.paused).toBe(false);
    expect(result.current.data?.nextRunAt).toMatch(/^2026-/);
  });

  it('says paused when every AI schedule is paused, and has no next run', async () => {
    server.use(
      http.get(`${PROJECT_PATH}/schedules`, () =>
        HttpResponse.json({
          data: [
            { is_active: false, next_run_at: '2026-11-16T00:00:00Z' },
            { is_active: false, next_run_at: '2026-11-19T00:00:00Z' },
          ],
          page: { offset: 0, limit: 10, total: 2 },
        }),
      ),
    );
    const { result } = renderHook(() => useOverviewSchedule(EVENTUS), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.data).toEqual({ nextRunAt: null, paused: true });
  });

  it('gives the earliest next run of the active schedules, and a project with none is not paused', async () => {
    server.use(
      http.get(`${PROJECT_PATH}/schedules`, () =>
        HttpResponse.json({
          data: [
            { is_active: true, next_run_at: '2026-11-19T00:00:00Z' },
            { is_active: true, next_run_at: '2026-11-16T00:00:00Z' },
            { is_active: false, next_run_at: '2026-11-14T00:00:00Z' },
          ],
          page: { offset: 0, limit: 10, total: 3 },
        }),
      ),
    );
    const first = renderHook(() => useOverviewSchedule(EVENTUS), { wrapper });
    await waitFor(() => {
      expect(first.result.current.status).toBe('ready');
    });
    expect(first.result.current.data).toEqual({ nextRunAt: '2026-11-16T00:00:00Z', paused: false });
    server.use(
      http.get(`${PROJECT_PATH}/schedules`, () =>
        HttpResponse.json({ data: [], page: { offset: 0, limit: 10, total: 0 } }),
      ),
    );
    const none = renderHook(() => useOverviewSchedule(FYNIX), { wrapper });
    await waitFor(() => {
      expect(none.result.current.status).toBe('ready');
    });
    expect(none.result.current.data).toEqual({ nextRunAt: null, paused: false });
  });
});

/** Lets a request that would have been sent on a render reach the server, so "none" is a fact and not a race. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 30);
    });
  });

/** A read of the scope, as a card makes it: the hook, the path it asks, and what it asks for when it runs. */
const SUBSCRIBABLE: readonly (readonly [
  name: string,
  suffix: string,
  use: (input: OverviewReadInput, subscribed: boolean) => Read<unknown>,
])[] = [
  ['summary', '/ai/prompts-summary', (input, subscribed) => useOverviewSummary(input, { subscribed })],
  ['sources', '/ai/sources/domains', (input, subscribed) => useOverviewSources(input, { subscribed })],
  ['fan-out', '/ai/fanout-queries', (input, subscribed) => useOverviewFanout(input, { subscribed })],
  ['schedule', '/schedules', (input, subscribed) => useOverviewSchedule(input.project, { subscribed })],
];

describe('the subscribed option of the reads', () => {
  const hookOf =
    (use: (input: OverviewReadInput, subscribed: boolean) => Read<unknown>) =>
    (props: { scope: OverviewScope; subscribed: boolean }): Read<unknown> =>
      use({ project: FYNIX, scope: props.scope, enabledEngines: ALL }, props.subscribed);

  it.each(SUBSCRIBABLE)(
    '%s: a paused read makes no request and is idle, never loading or error',
    async (_, suffix, use) => {
      const seen = recordRequests();
      const { result } = renderHook(hookOf(use), { wrapper, initialProps: { scope: scopeOf(), subscribed: false } });
      // The fan-out read first learns the engines (a request of its own), then knows it has nothing to ask
      await waitFor(() => {
        expect(result.current.status).toBe('idle');
      });
      await settle();
      expect(result.current.data).toBeUndefined();
      expect(result.current.errorId).toBeNull();
      expect(to(seen, suffix)).toHaveLength(0);
    },
  );

  it.each(SUBSCRIBABLE)('%s: subscribing again makes exactly one request', async (_, suffix, use) => {
    const seen = recordRequests();
    const { result, rerender } = renderHook(hookOf(use), {
      wrapper,
      initialProps: { scope: scopeOf(), subscribed: false },
    });
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    rerender({ scope: scopeOf(), subscribed: true });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    await settle();
    expect(to(seen, suffix)).toHaveLength(1);
  });

  it.each(SUBSCRIBABLE)('%s: pausing keeps the last data and asks for nothing more', async (_, suffix, use) => {
    const seen = recordRequests();
    const { result, rerender } = renderHook(hookOf(use), {
      wrapper,
      initialProps: { scope: scopeOf(), subscribed: true },
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const before = result.current.data;
    rerender({ scope: scopeOf(), subscribed: false });
    await settle();
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe(before);
    expect(to(seen, suffix)).toHaveLength(1);
  });

  it('shows no data of an earlier scope while paused: the last data is only the data of this scope', async () => {
    const seen = recordRequests();
    const { result, rerender } = renderHook(
      hookOf((input, subscribed) => useOverviewSummary(input, { subscribed })),
      {
        wrapper,
        initialProps: { scope: scopeOf(), subscribed: true },
      },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    rerender({ scope: scopeOf({ country: 'DE' }), subscribed: false });
    await settle();
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(1);
    rerender({ scope: scopeOf({ country: 'DE' }), subscribed: true });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(2);
  });

  it('never turns a paused read into an error: a failing API is not asked, and is reported once it is', async () => {
    server.use(http.get(`${PROJECT_PATH}/ai/prompts-summary`, () => failing('req-paused')));
    const { result, rerender } = renderHook(
      hookOf((input, subscribed) => useOverviewSummary(input, { subscribed })),
      { wrapper, initialProps: { scope: scopeOf(), subscribed: false } },
    );
    await settle();
    expect(result.current.status).toBe('idle');
    expect(result.current.errorId).toBeNull();
    rerender({ scope: scopeOf(), subscribed: true });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.errorId).toBe('req-paused');
  });

  it('periods: paused makes no request and settles, not paired; subscribing reads both windows once and pairs them', async () => {
    const seen = recordRequests();
    const { result, rerender } = renderHook(
      (props: { subscribed: boolean }) => useOverviewPeriods(inputOf(), { subscribed: props.subscribed }),
      { wrapper, initialProps: { subscribed: false } },
    );
    await settle();
    expect(result.current.current.status).toBe('idle');
    expect(result.current.previous?.status).toBe('idle');
    expect(result.current.settled).toBe(true);
    expect(result.current.paired).toBe(false);
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(0);
    rerender({ subscribed: true });
    await waitFor(() => {
      expect(result.current.paired).toBe(true);
    });
    expect(result.current.settled).toBe(true);
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(2);
  });

  it('periods: pausing after the data is in keeps both windows paired and settled', async () => {
    const { result, rerender } = renderHook(
      (props: { subscribed: boolean }) => useOverviewPeriods(inputOf(), { subscribed: props.subscribed }),
      { wrapper, initialProps: { subscribed: true } },
    );
    await waitFor(() => {
      expect(result.current.paired).toBe(true);
    });
    rerender({ subscribed: false });
    await settle();
    expect(result.current.paired).toBe(true);
    expect(result.current.settled).toBe(true);
    expect(result.current.current.data).toBeDefined();
  });

  it('is subscribed when the option is left out or undefined, as before', async () => {
    const seen = recordRequests();
    const { result } = renderHook(
      () => ({
        summary: useOverviewSummary(inputOf()),
        sources: useOverviewSources(inputOf(), { subscribed: undefined }),
        schedule: useOverviewSchedule(FYNIX),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.summary.status).toBe('ready');
      expect(result.current.sources.status).toBe('ready');
      expect(result.current.schedule.status).toBe('ready');
    });
    expect(to(seen, '/ai/prompts-summary')).toHaveLength(1);
  });
});
