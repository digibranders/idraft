import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSourceDomains, type DomainListOptions } from './source-reads';
import { OverviewProvider } from '../../../overview-context';
import { domainPage, domainRow, PREVIOUS_WINDOW, sourcesMeta } from '../model/source-fixtures';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const DOMAINS = '*/api/v1/workspaces/:w/projects/:p/ai/sources/domains';

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
const domainReads = (seen: readonly URL[]): URL[] => seen.filter((url) => url.pathname.endsWith('/sources/domains'));

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
});

function Probe({ name, options }: { name: string; options: DomainListOptions }): ReactElement {
  const reads = useSourceDomains(options);
  const previous = reads.previous === null ? 'no-previous' : reads.previous.status;
  return <p data-testid={name}>{`${reads.current.status} ${previous} ${reads.askable} ${String(reads.compared)}`}</p>;
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

/** A handler that answers the read of the window and, for any other window, the totals of the window before. */
function serve(previousAnswers: number | undefined, total = 800): void {
  server.use(
    http.get(DOMAINS, ({ request }) => {
      const asked = new URL(request.url).searchParams;
      if (asked.get('from') === PREVIOUS_WINDOW.from) {
        return HttpResponse.json(domainPage([], sourcesMeta({ units: total, answers: 90 })));
      }
      return HttpResponse.json(
        domainPage(
          [domainRow({ domain: 'g2.com', units: 190, previous: { units: 164, answers: 90 } })],
          sourcesMeta({ ...(previousAnswers === undefined ? {} : { previousAnswers }) }),
        ),
      );
    }),
  );
}

const OPTIONS: DomainListOptions = { limit: 8, compare: true };

describe('useSourceDomains', () => {
  it('asks the scope as the strip does, with the limit, at least two units and the comparison', async () => {
    const seen = recordRequests();
    serve(80);
    renderWith(<Probe name="a" options={OPTIONS} />);
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ready ok true');
    });
    const [current] = domainReads(seen);
    expect(current?.searchParams.get('from')).toBe('2026-10-16');
    expect(current?.searchParams.get('to')).toBe('2026-11-12');
    expect(current?.searchParams.get('limit')).toBe('8');
    expect(current?.searchParams.get('min_support')).toBe('2');
    expect(current?.searchParams.get('compare')).toBe('previous_period');
    expect(current?.searchParams.has('filter[engine_code_in]')).toBe(false);
    expect(current?.searchParams.has('include_unresolved_redirects')).toBe(false);
    expect(current?.searchParams.has('include_engine_internal')).toBe(false);
  });

  it('is one request for two cards with equal options', async () => {
    const seen = recordRequests();
    serve(80);
    renderWith(
      <>
        <Probe name="a" options={OPTIONS} />
        <Probe name="b" options={{ ...OPTIONS }} />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ready');
      expect(screen.getByTestId('b')).toHaveTextContent('ready ready');
    });
    // The window and the window before: two requests however many cards read them
    expect(domainReads(seen)).toHaveLength(2);
  });

  it('reads the totals of the window before, with no role and one row, when the comparison is on and had answers', async () => {
    const seen = recordRequests();
    serve(80);
    renderWith(<Probe name="a" options={{ ...OPTIONS, roles: ['third_party'] }} />);
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ready');
    });
    const reads = domainReads(seen);
    expect(reads).toHaveLength(2);
    const before = reads.find((url) => url.searchParams.get('from') === PREVIOUS_WINDOW.from);
    expect(before?.searchParams.get('to')).toBe(PREVIOUS_WINDOW.to);
    expect(before?.searchParams.get('limit')).toBe('1');
    expect(before?.searchParams.has('compare')).toBe(false);
    expect(before?.searchParams.has('filter[domain_role_in]')).toBe(false);
    const now = reads.find((url) => url.searchParams.get('from') === '2026-10-16');
    expect(now?.searchParams.get('filter[domain_role_in]')).toBe('third_party');
  });

  it('does not read the window before when it had no answers: its units say nothing', async () => {
    const seen = recordRequests();
    serve(0);
    renderWith(<Probe name="a" options={OPTIONS} />);
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready no-previous ok true');
    });
    expect(domainReads(seen)).toHaveLength(1);
  });

  it('does not compare while the scope has the comparison off', async () => {
    const seen = recordRequests();
    serve(undefined);
    renderWith(<Probe name="a" options={OPTIONS} />, 'cmp=off');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready no-previous ok false');
    });
    const reads = domainReads(seen);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.searchParams.has('compare')).toBe(false);
  });

  it('sends the engines of the scope when a subset is asked', async () => {
    const seen = recordRequests();
    serve(undefined);
    renderWith(<Probe name="a" options={OPTIONS} />, 'cmp=off&engine=gemini_web');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready');
    });
    expect(domainReads(seen)[0]?.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
  });

  it('asks nothing and is idle when no engine is on', async () => {
    const seen = recordRequests();
    renderWith(<Probe name="a" options={OPTIONS} />, '', 'cleanstart');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle no-previous no_engine');
    });
    expect(domainReads(seen)).toHaveLength(0);
  });

  it('asks nothing and is idle for branded prompts alone, which the route cannot filter', async () => {
    const seen = recordRequests();
    renderWith(<Probe name="a" options={OPTIONS} />, 'branded=only');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle no-previous branded_only');
    });
    expect(domainReads(seen)).toHaveLength(0);
  });
});
