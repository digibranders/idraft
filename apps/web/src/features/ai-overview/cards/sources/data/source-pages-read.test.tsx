import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSourcePages } from './source-reads';
import { OverviewProvider } from '../../../overview-context';
import { pagePage, pageRow } from '../model/page-fixtures';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const PAGES = '*/api/v1/workspaces/:w/projects/:p/ai/sources/pages';

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
const pageReads = (seen: readonly URL[]): URL[] => seen.filter((url) => url.pathname.endsWith('/sources/pages'));

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
});

function Probe({ name, limit }: { name: string; limit: number }): ReactElement {
  const reads = useSourcePages({ limit });
  return <p data-testid={name}>{`${reads.current.status} ${reads.askable}`}</p>;
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

const serve = (): void => {
  server.use(
    http.get(PAGES, () => HttpResponse.json(pagePage([pageRow({ url: 'https://fynix.com/', urlId: 1, units: 5 })]))),
  );
};

describe('useSourcePages', () => {
  it('asks the own pages of the scope with the limit, and no comparison and no minimum', async () => {
    const seen = recordRequests();
    serve();
    renderWith(<Probe name="a" limit={8} />, 'cmp=off');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ok');
    });
    const [read] = pageReads(seen);
    expect(pageReads(seen)).toHaveLength(1);
    expect(read?.searchParams.get('filter[domain_role_in]')).toBe('own');
    expect(read?.searchParams.get('limit')).toBe('8');
    expect(read?.searchParams.get('from')).toBe('2026-10-16');
    expect(read?.searchParams.has('compare')).toBe(false);
    expect(read?.searchParams.has('min_support')).toBe(false);
    expect(read?.searchParams.has('include_unresolved_redirects')).toBe(false);
    expect(read?.searchParams.has('include_engine_internal')).toBe(false);
  });

  it('is one request for two cards with equal options', async () => {
    const seen = recordRequests();
    serve();
    renderWith(
      <>
        <Probe name="a" limit={8} />
        <Probe name="b" limit={8} />
      </>,
      'cmp=off',
    );
    await waitFor(() => {
      expect(screen.getByTestId('b')).toHaveTextContent('ready ok');
    });
    expect(pageReads(seen)).toHaveLength(1);
  });

  it('asks nothing for a scope that cannot be asked, and says why', async () => {
    const seen = recordRequests();
    serve();
    renderWith(<Probe name="a" limit={8} />, 'cmp=off&branded=only');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle branded_only');
    });
    expect(pageReads(seen)).toHaveLength(0);
  });

  it('asks nothing while no engine of the project is on, and says so', async () => {
    const seen = recordRequests();
    serve();
    renderWith(<Probe name="a" limit={8} />, 'cmp=off', 'cleanstart');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle no_engine');
    });
    expect(pageReads(seen)).toHaveLength(0);
  });
});
