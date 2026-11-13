import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNewSources } from './use-new-sources';
import type { Read } from '../../data/read-state';
import { OverviewProvider, useOverview } from '../../overview-context';
import type { NewSourcesCount } from './facts-model';
import { makeQueryClient } from '@/lib/api/query-client';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';

const WINDOW = 'from=2026-10-16&to=2026-11-12';
const CHANGES = '*/api/v1/workspaces/:w/projects/:p/ai/sources/changes';
const TOPIC = '0b1f2a3c-4d5e-4f60-8a7b-9c0d1e2f3a4b';

/** What the tests read: the hook's read, and how many engines the overview knows (0 until its engines read answers). */
interface Probe {
  read: Read<NewSourcesCount>;
  enabled: number;
}

/** The query string the wrapper renders; a test changes it and rerenders to change the scope. */
const url = { search: WINDOW };

function hookOf(search: string = WINDOW): ReturnType<typeof renderHook<Probe, unknown>> {
  url.search = search;
  const client = makeQueryClient({ retry: false });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={url.search} hasMemory>
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
  return renderHook((): Probe => ({ read: useNewSources(), enabled: useOverview().enabledEngines.length }), {
    wrapper,
  });
}

/**
 * Waits until the engines are known and then lets any request the hook would send go out. Until then the hook is
 * idle whatever the scope says, so an assertion made earlier would pass with the gate removed.
 */
async function settled(result: { current: Probe }): Promise<void> {
  await waitFor(() => {
    expect(result.current.enabled).toBeGreaterThan(0);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const listeners: ((info: { request: Request }) => void)[] = [];
/** The requests for new sources the server sees from now until the test ends. */
function recordChanges(): URL[] {
  const seen: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ai/sources/changes')) seen.push(url);
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

describe('useNewSources', () => {
  it('asks kind=new with limit 1 and the scope window, engines, country, topic and branded', async () => {
    const seen = recordChanges();
    // A topic of the mock world is not needed to see the request: any page answers
    server.use(
      http.get(CHANGES, () =>
        HttpResponse.json({ data: [], meta: { min_support: 2 }, page: { limit: 1, offset: 0, total: 0 } }),
      ),
    );
    const { result } = hookOf(`${WINDOW}&engine=gemini_web&country=DE&topic=${TOPIC}&branded=included`);
    await waitFor(() => {
      expect(result.current.read.status).toBe('ready');
    });
    expect(seen).toHaveLength(1);
    const params = seen[0]?.searchParams;
    expect(params?.get('kind')).toBe('new');
    expect(params?.get('limit')).toBe('1');
    expect(params?.get('from')).toBe('2026-10-16');
    expect(params?.get('to')).toBe('2026-11-12');
    expect(params?.getAll('filter[engine_code_in]')).toEqual(['gemini_web']);
    expect(params?.get('filter[country_iso]')).toBe('DE');
    expect(params?.get('filter[term]')).toBe(TOPIC);
    expect(params?.get('include_branded')).toBe('true');
  });

  it('answers the total of rows and the support asked of each, from the page and its meta', async () => {
    const { result } = hookOf();
    await waitFor(() => {
      expect(result.current.read.status).toBe('ready');
    });
    // The mock world of Fynix has one domain that first appears in this window, with the default support of 2
    expect(result.current.read.data).toEqual({ total: 1, minSupport: 2 });
  });

  it('leaves branded prompts out by default and sends include_branded false', async () => {
    const seen = recordChanges();
    const { result } = hookOf();
    await waitFor(() => {
      expect(result.current.read.status).toBe('ready');
    });
    expect(seen[0]?.searchParams.get('include_branded')).toBe('false');
    expect(seen[0]?.searchParams.has('filter[engine_code_in]')).toBe(false);
  });

  it('runs once the engines are known, with branded prompts left out and the comparison on (the control of the two tests below)', async () => {
    const seen = recordChanges();
    const { result } = hookOf();
    await settled(result);
    expect(seen).toHaveLength(1);
    expect(result.current.read.status).not.toBe('idle');
  });

  it('does not run for branded only: the endpoint takes include_branded and cannot keep them alone', async () => {
    const seen = recordChanges();
    const { result } = hookOf(`${WINDOW}&branded=only`);
    await settled(result);
    expect(result.current.read.status).toBe('idle');
    expect(seen).toHaveLength(0);
  });

  it('does not run with the comparison off: new sources are against the window before', async () => {
    const seen = recordChanges();
    const { result } = hookOf(`${WINDOW}&cmp=off`);
    await settled(result);
    expect(result.current.read.status).toBe('idle');
    expect(seen).toHaveLength(0);
  });

  it('keeps no data across a scope change: the new scope shows nothing while it loads', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(CHANGES, async ({ request }) => {
        const total = new URL(request.url).searchParams.get('filter[country_iso]') === 'DE' ? 7 : 3;
        if (total === 3) await gate;
        return HttpResponse.json({ data: [], meta: { min_support: 2 }, page: { limit: 1, offset: 0, total } });
      }),
    );
    const { result, rerender } = hookOf(`${WINDOW}&country=DE`);
    await waitFor(() => {
      expect(result.current.read.data).toEqual({ total: 7, minSupport: 2 });
    });
    url.search = `${WINDOW}&country=FR`;
    rerender();
    await waitFor(() => {
      expect(result.current.read.status).toBe('loading');
    });
    expect(result.current.read.data).toBeUndefined();
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(result.current.read.data).toEqual({ total: 3, minSupport: 2 });
    });
  });

  it('gives no data and an error status, never a throw, when the read fails', async () => {
    server.use(
      http.get(CHANGES, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req-new' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { result } = hookOf();
    await waitFor(() => {
      expect(result.current.read.status).toBe('error');
    });
    expect(result.current.read.data).toBeUndefined();
  });
});
