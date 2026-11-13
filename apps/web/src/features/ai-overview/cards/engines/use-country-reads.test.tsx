import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCountryReads, type CountryReads } from './use-country-reads';
import { OverviewProvider, useOverview, type OverviewContextValue } from '../../overview-context';
import { makeQueryClient } from '@/lib/api/query-client';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';

const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

interface Hook {
  reads: CountryReads;
  overview: OverviewContextValue;
}

function hookOf(search: string = WINDOW): ReturnType<typeof renderHook<Hook, unknown>> {
  const client = makeQueryClient({ retry: false });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} hasMemory>
        <PermissionProvider membership={membershipFactory('admin')}>
          <OverviewProvider
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={overviewProject('fynix')}
          >
            {children}
          </OverviewProvider>
        </PermissionProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>
  );
  return renderHook((): Hook => ({ reads: useCountryReads(), overview: useOverview() }), { wrapper });
}

const answered = async (result: { current: Hook }): Promise<void> => {
  await waitFor(() => {
    expect(result.current.reads.reads).toHaveLength(2);
    expect(result.current.reads.reads.every((read) => read.status === 'ready')).toBe(true);
  });
};

const listeners: ((info: { request: Request }) => void)[] = [];
function recordSummaryRequests(): URL[] {
  const seen: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ai/prompts-summary')) seen.push(url);
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return seen;
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
});

describe('useCountryReads', () => {
  it('takes the countries from the prompts of the project (Fynix: DE and IN)', async () => {
    const { result } = hookOf();
    await answered(result);
    expect(result.current.reads.countries.data).toEqual(['DE', 'IN']);
    expect(result.current.reads.reads.map((read) => read.country)).toEqual(['DE', 'IN']);
    expect(result.current.reads.reads.map((read) => read.prompts?.length)).toEqual([22, 1]);
  });

  it('asks one summary request per country with filter[country_iso] and the rest of the scope', async () => {
    const seen = recordSummaryRequests();
    const { result } = hookOf(`${WINDOW}&branded=included&engine=gemini_web`);
    await answered(result);
    const countries = seen.map((url) => url.searchParams.get('filter[country_iso]')).sort();
    expect(countries).toEqual(['DE', 'IN']);
    for (const url of seen) {
      expect(url.searchParams.get('from')).toBe('2026-10-16');
      expect(url.searchParams.get('to')).toBe('2026-11-12');
      expect(url.searchParams.get('include_branded')).toBe('true');
    }
  });

  it('ignores the page country filter: every country is read whatever country the page is on', async () => {
    const seen = recordSummaryRequests();
    const { result } = hookOf(`${WINDOW}&country=IN`);
    await answered(result);
    expect(seen.map((url) => url.searchParams.get('filter[country_iso]')).sort()).toEqual(['DE', 'IN']);
    expect(result.current.reads.reads.map((read) => read.prompts?.length)).toEqual([22, 1]);
  });

  it('leaves the other countries and gives the failed one an error id and a retry', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) =>
        new URL(request.url).searchParams.get('filter[country_iso]') === 'IN' ? failing('req-india') : undefined,
      ),
    );
    const { result } = hookOf();
    await waitFor(() => {
      expect(result.current.reads.reads.map((read) => read.status)).toEqual(['ready', 'error']);
    });
    const [germany, india] = result.current.reads.reads;
    expect(germany).toMatchObject({ country: 'DE', failed: false, status: 'ready', errorId: null });
    expect(germany?.prompts).toHaveLength(22);
    expect(india).toMatchObject({ country: 'IN', failed: true, prompts: null, errorId: 'req-india' });
    expect(india?.retry).toEqual(expect.any(Function));
    server.resetHandlers();
    act(() => {
      india?.retry();
    });
    await answered(result);
    expect(result.current.reads.reads[1]?.prompts).toHaveLength(1);
  });

  it('keeps a failed country as a retrying group, with its error id, while only that country is read again', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) =>
        new URL(request.url).searchParams.get('filter[country_iso]') === 'IN' ? failing('req-india') : undefined,
      ),
    );
    const { result } = hookOf();
    await waitFor(() => {
      expect(result.current.reads.reads.map((read) => read.status)).toEqual(['ready', 'error']);
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.resetHandlers();
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        if (new URL(request.url).searchParams.get('filter[country_iso]') === 'IN') await gate;
        return undefined;
      }),
    );
    act(() => {
      result.current.reads.reads[1]?.retry();
    });
    // Not 'loading': a card whose read is loading is drawn as a skeleton, and Germany would go with it
    await waitFor(() => {
      expect(result.current.reads.reads[1]).toMatchObject({
        country: 'IN',
        failed: true,
        status: 'refetching',
        prompts: null,
        errorId: 'req-india',
      });
    });
    expect(result.current.reads.reads[0]).toMatchObject({ country: 'DE', failed: false, status: 'ready' });
    act(() => {
      release();
    });
    await answered(result);
    expect(result.current.reads.reads[1]).toMatchObject({ failed: false, errorId: null, status: 'ready' });
  });

  it('adds no country of its own for a page country that no prompt has', async () => {
    const { result } = hookOf(`${WINDOW}&country=FR`);
    await answered(result);
    expect(result.current.reads.countries.data).toEqual(['DE', 'IN']);
    expect(result.current.reads.reads.map((read) => read.country)).toEqual(['DE', 'IN']);
  });

  it('keeps every group on screen while a new scope is read', async () => {
    const { result } = hookOf();
    await answered(result);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        if (new URL(request.url).searchParams.get('include_branded') === 'true') await gate;
        return undefined;
      }),
    );
    act(() => {
      result.current.overview.setScope({ branded: 'included' });
    });
    await waitFor(() => {
      expect(result.current.reads.reads.map((read) => read.status)).toEqual(['refetching', 'refetching']);
    });
    expect(result.current.reads.reads.map((read) => read.prompts?.length)).toEqual([22, 1]);
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(result.current.reads.reads.map((read) => read.status)).toEqual(['ready', 'ready']);
    });
    // Germany has one branded prompt more
    expect(result.current.reads.reads[0]?.prompts).toHaveLength(23);
  });
});
