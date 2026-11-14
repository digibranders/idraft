import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MIN_QUERY_ANSWERS, useFanoutRows } from './fanout-reads';
import { OverviewProvider, useOverviewFanout } from '../../../overview-context';
import { fanoutPage, fanoutRow } from '../model/fanout-fixtures';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const FANOUT = '*/api/v1/workspaces/:w/projects/:p/ai/fanout-queries';

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
const fanoutReads = (seen: readonly URL[]): URL[] => seen.filter((url) => url.pathname.endsWith('/fanout-queries'));

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  server.use(http.get(FANOUT, () => HttpResponse.json(fanoutPage([fanoutRow({ text: 'a query', observations: 5 })]))));
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
});

function Probe({ name, limit = 5 }: { name: string; limit?: number }): ReactElement {
  const reads = useFanoutRows({ limit });
  return <p data-testid={name}>{`${reads.current.status} ${reads.askable} ${reads.without.join(',')}`}</p>;
}

/** The meta read of the strip, so the test can compare the two requests. */
function StripProbe(): ReactElement {
  const strip = useOverviewFanout();
  return <p data-testid="strip">{strip.status}</p>;
}

function renderWith(ui: ReactElement, searchParams = '', world: OverviewWorld = 'fynix'): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <OverviewProvider
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        project={overviewProject(world)}
      >
        {ui}
      </OverviewProvider>
    </PermissionProvider>,
    { searchParams },
  );
}

const paramsOf = (url: URL | undefined, leave: readonly string[]): [string, string][] =>
  [...(url?.searchParams.entries() ?? [])].filter(([name]) => !leave.includes(name)).sort();

describe('useFanoutRows', () => {
  it('asks the rows with the limit and the minimum of answers, as the strip asks its meta, over the same scope', async () => {
    const seen = recordRequests();
    renderWith(
      <>
        <Probe name="a" limit={10} />
        <StripProbe />
      </>,
      'cmp=off&country=DE&branded=included',
    );
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ok');
      expect(screen.getByTestId('strip')).toHaveTextContent('ready');
    });
    const reads = fanoutReads(seen);
    expect(reads).toHaveLength(2);
    const rows = reads.find((url) => url.searchParams.get('limit') === '10');
    const strip = reads.find((url) => url.searchParams.get('limit') === '1');
    expect(rows?.searchParams.get('min_support')).toBe(String(MIN_QUERY_ANSWERS));
    expect(paramsOf(rows, ['limit', 'min_support'])).toEqual(paramsOf(strip, ['limit', 'min_support']));
    expect(rows?.searchParams.get('include_branded')).toBe('true');
    expect(rows?.searchParams.get('filter[country_iso]')).toBe('DE');
  });

  it('is one request for two cards with equal options', async () => {
    const seen = recordRequests();
    renderWith(
      <>
        <Probe name="a" />
        <Probe name="b" />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready');
      expect(screen.getByTestId('b')).toHaveTextContent('ready');
    });
    expect(fanoutReads(seen)).toHaveLength(1);
  });

  it('names the asked engines that show no queries, and leaves the engine filter out when every engine that shows them is asked', async () => {
    const seen = recordRequests();
    renderWith(<Probe name="a" />, 'cmp=off&engine=chatgpt_web,gemini_web');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ok gemini_web');
    });
    expect(fanoutReads(seen)[0]?.searchParams.has('filter[engine_code_in]')).toBe(false);
  });

  it('asks nothing, and says the queries are not exposed, when the engine choice holds only engines that show none', async () => {
    const seen = recordRequests();
    renderWith(<Probe name="a" />, 'cmp=off&engine=gemini_web');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle no_fanout gemini_web');
    });
    expect(fanoutReads(seen)).toHaveLength(0);
  });

  it('asks nothing for branded prompts alone, which the route cannot read', async () => {
    const seen = recordRequests();
    renderWith(<Probe name="a" />, 'cmp=off&branded=only');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle branded_only');
    });
    expect(fanoutReads(seen)).toHaveLength(0);
  });

  it('asks nothing when no engine is on for the project', async () => {
    const seen = recordRequests();
    renderWith(<Probe name="a" />, 'cmp=off', 'cleanstart');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle no_engine');
    });
    expect(fanoutReads(seen)).toHaveLength(0);
  });
});
