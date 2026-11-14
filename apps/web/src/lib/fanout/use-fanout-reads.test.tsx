import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor, type RenderHookResult } from '@testing-library/react';
import { http } from 'msw';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineNotExposedError } from './fanout-queries';
import type { FanoutFilters } from './types';
import { useFanoutReads, type FanoutReads, type FanoutReadsOptions } from './use-fanout-reads';
import messages from '../../../messages/en.json';
import { makeQueryClient } from '@/lib/api/query-client';
import type { SourceScope } from '@/lib/citations/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const scope: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const FILTERS: FanoutFilters = { from: '2026-10-16', to: '2026-11-12', engine: ENGINE_FACTS.chatgpt_web };
const OPTIONS = { minSupport: 2, limit: 10, previous: true } as const;
/** Thursday 12 November 2026, noon UTC. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const FANOUT = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/fanout-queries');

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </NextIntlClientProvider>
);

/** The URL of every fan-out request the mock server saw. */
function watch(): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ai/fanout-queries')) seen.push(url);
  });
  return seen;
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(NOW + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

type Props = { filters: FanoutFilters | undefined; options?: FanoutReadsOptions };
const hook = (initial: Props): RenderHookResult<FanoutReads, Props> =>
  renderHook(({ filters, options = OPTIONS }: Props) => useFanoutReads(scope, filters, options), {
    wrapper,
    initialProps: initial,
  });

describe('useFanoutReads', () => {
  it('reads the current page with one engine and the previous page with min_support 1', async () => {
    const seen = watch();
    const { result } = hook({ filters: FILTERS });
    expect(result.current.current.status).toBe('loading');
    await waitFor(() => expect(result.current.previous.status).toBe('ready'));
    expect(result.current.current.status).toBe('ready');
    expect(result.current.current.errorId).toBeNull();
    expect(seen).toHaveLength(2);
    const current = seen.find((url) => url.searchParams.get('min_support') === '2')?.searchParams;
    expect(current?.get('from')).toBe('2026-10-16');
    expect(current?.get('to')).toBe('2026-11-12');
    expect(current?.get('filter[engine_code_in]')).toBe('chatgpt_web');
    expect(current?.get('limit')).toBe('10');
    const previous = seen.find((url) => url.searchParams.get('min_support') === '1')?.searchParams;
    expect(previous?.get('from')).toBe('2026-09-18');
    expect(previous?.get('to')).toBe('2026-10-15');
    expect(previous?.get('filter[engine_code_in]')).toBe('chatgpt_web');
    expect(previous?.get('limit')).toBe('200');
    expect(previous?.has('include')).toBe(false);
  });

  it('does not read the previous page while previous is false', async () => {
    const seen = watch();
    const { result } = hook({ filters: FILTERS, options: { ...OPTIONS, previous: false } });
    await waitFor(() => expect(result.current.current.status).toBe('ready'));
    expect(seen).toHaveLength(1);
    expect(result.current.previous.status).toBe('idle');
    expect(result.current.previous.data).toBeUndefined();
  });

  it('reads nothing while there is no engine to name', () => {
    const seen = watch();
    const { result } = hook({ filters: undefined });
    expect(seen).toHaveLength(0);
    expect(result.current.current.status).toBe('idle');
    expect(result.current.previous.status).toBe('idle');
    expect(result.current.topics.status).toBe('idle');
  });

  it('reads nothing while it is turned off', () => {
    const seen = watch();
    hook({ filters: FILTERS, options: { ...OPTIONS, enabled: false } });
    expect(seen).toHaveLength(0);
  });

  it('never names an engine that does not expose fan-out', () => {
    const seen = watch();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => hook({ filters: { ...FILTERS, engine: ENGINE_FACTS.gemini_web } })).toThrow(EngineNotExposedError);
    expect(seen).toHaveLength(0);
  });

  it('keeps the current rows when the previous read fails, and flags the previous as failed', async () => {
    server.use(
      http.get(FANOUT, ({ request }) =>
        new URL(request.url).searchParams.get('min_support') === '1' ? problem(request, 'not_found') : undefined,
      ),
    );
    const { result } = hook({ filters: FILTERS });
    await waitFor(() => expect(result.current.previous.status).toBe('error'));
    expect(result.current.current.status).toBe('ready');
    expect(result.current.current.data?.data.length).toBeGreaterThan(0);
    expect(result.current.previous.data).toBeUndefined();
    expect(result.current.previous.errorId?.id).toBeTruthy();
  });

  it('says error with an id for a failed current read, and reads again on retry', async () => {
    server.use(http.get(FANOUT, ({ request }) => problem(request, 'not_found')));
    const { result } = hook({ filters: FILTERS, options: { ...OPTIONS, previous: false } });
    await waitFor(() => expect(result.current.current.status).toBe('error'));
    expect(result.current.current.errorId?.id).toBeTruthy();
    server.resetHandlers();
    act(() => result.current.current.retry());
    await waitFor(() => expect(result.current.current.status).toBe('ready'));
    expect(result.current.current.errorId).toBeNull();
  });

  it('keeps the rows it has while a new window is read, and says it is refreshing', async () => {
    const held = gate();
    server.use(
      http.get(FANOUT, async ({ request }) => {
        if (new URL(request.url).searchParams.get('to') === '2026-11-11') await held.promise;
        return undefined;
      }),
    );
    const { result, rerender } = hook({ filters: FILTERS, options: { ...OPTIONS, previous: false } });
    await waitFor(() => expect(result.current.current.status).toBe('ready'));
    expect(result.current.current.refreshing).toBe(false);
    const first = result.current.current.data;
    rerender({ filters: { ...FILTERS, to: '2026-11-11' }, options: { ...OPTIONS, previous: false } });
    await waitFor(() => expect(result.current.current.refreshing).toBe(true));
    expect(result.current.current.status).toBe('ready');
    expect(result.current.current.data).toBe(first);
    held.open();
    await waitFor(() => expect(result.current.current.refreshing).toBe(false));
    expect(result.current.current.data).not.toBe(first);
  });

  it('holds for five minutes: a re-render and a new mount do not read again', async () => {
    const seen = watch();
    const first = hook({ filters: FILTERS });
    await waitFor(() => expect(first.result.current.previous.status).toBe('ready'));
    first.rerender({ filters: FILTERS });
    first.unmount();
    const second = hook({ filters: FILTERS });
    await waitFor(() => expect(second.result.current.previous.status).toBe('ready'));
    expect(seen).toHaveLength(2);
  });

  it('reads the topics as a separate read, only when asked', async () => {
    const seen = watch();
    const without = hook({ filters: FILTERS, options: { ...OPTIONS, previous: false } });
    await waitFor(() => expect(without.result.current.current.status).toBe('ready'));
    expect(without.result.current.topics.status).toBe('idle');
    expect(seen.some((url) => url.searchParams.has('include'))).toBe(false);
    without.unmount();
    seen.length = 0;

    const asked = hook({ filters: FILTERS, options: { ...OPTIONS, previous: false, topics: true } });
    await waitFor(() => expect(asked.result.current.topics.status).toBe('ready'));
    const withTopics = seen.filter((url) => url.searchParams.get('include') === 'topics');
    expect(withTopics).toHaveLength(1);
    expect(withTopics[0]?.searchParams.get('limit')).toBe('200');
    expect(asked.result.current.topics.data?.data.every((entry) => entry.topics !== undefined)).toBe(true);
    // The current read of the same scope has no topics: it is its own cache entry
    expect(asked.result.current.current.data?.data.some((entry) => entry.topics !== undefined)).toBe(false);
  });
});
