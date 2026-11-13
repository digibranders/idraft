import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSourceChanges, useSourceDiversity } from './source-reads';
import { OverviewProvider } from '../../../overview-context';
import { changePage, changeRow, diversityEngine, diversityRead, diversityWeek } from '../model/change-fixtures';
import { domainPage, PREVIOUS_WINDOW, sourcesMeta } from '../model/source-fixtures';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const P = '*/api/v1/workspaces/:w/projects/:p/ai/sources';
const CHANGES = `${P}/changes`;
const DOMAINS = `${P}/domains`;
const DIVERSITY = `${P}/diversity`;

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

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
});

function ChangesProbe({ name }: { name: string }): ReactElement {
  const reads = useSourceChanges({ limit: 8 });
  const before = reads.before === null ? 'no-before' : `${reads.before.status}:${String(reads.before.data)}`;
  return <p data-testid={name}>{`${reads.newer.status} ${reads.lost.status} ${before} ${reads.askable}`}</p>;
}

function DiversityProbe({ name }: { name: string }): ReactElement {
  const reads = useSourceDiversity();
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

function serveChanges(previousAnswers = 5000): void {
  server.use(
    http.get(CHANGES, ({ request }) => {
      const kind = new URL(request.url).searchParams.get('kind') === 'lost' ? 'lost' : 'new';
      return HttpResponse.json(changePage(kind, [changeRow({ domain: 'a.com', now: 4, before: 0 })], { total: 37 }));
    }),
    http.get(DOMAINS, () =>
      HttpResponse.json(domainPage([], sourcesMeta({ units: 900, answers: previousAnswers, engines: ['chatgpt_web'] }))),
    ),
  );
}

describe('useSourceChanges', () => {
  it('is one request for each kind, with the scope, the limit and two units of support', async () => {
    const seen = recordRequests();
    serveChanges();
    renderWith(<ChangesProbe name="a" />, 'cmp=off');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ready ready:5000 ok');
    });
    const reads = to(seen, '/sources/changes');
    expect(reads).toHaveLength(2);
    expect(reads.map((url) => url.searchParams.get('kind')).sort()).toEqual(['lost', 'new']);
    for (const url of reads) {
      expect(url.searchParams.get('from')).toBe('2026-10-16');
      expect(url.searchParams.get('to')).toBe('2026-11-12');
      expect(url.searchParams.get('limit')).toBe('8');
      expect(url.searchParams.get('min_support')).toBe('2');
      expect(url.searchParams.has('filter[engine_code_in]')).toBe(false);
      expect(url.searchParams.has('include_unresolved_redirects')).toBe(false);
      expect(url.searchParams.has('include_engine_internal')).toBe(false);
    }
  });

  it('is one request per kind for two cards that read the same lists', async () => {
    const seen = recordRequests();
    serveChanges();
    renderWith(
      <>
        <ChangesProbe name="a" />
        <ChangesProbe name="b" />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ready ready');
      expect(screen.getByTestId('b')).toHaveTextContent('ready ready ready');
    });
    expect(to(seen, '/sources/changes')).toHaveLength(2);
  });

  it('reads the answers of the window the new list compares with, one row, whatever the scope compares', async () => {
    const seen = recordRequests();
    serveChanges(0);
    renderWith(<ChangesProbe name="a" />, 'cmp=off');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ready ready:0');
    });
    const [before] = to(seen, '/sources/domains');
    expect(before?.searchParams.get('from')).toBe(PREVIOUS_WINDOW.from);
    expect(before?.searchParams.get('to')).toBe(PREVIOUS_WINDOW.to);
    expect(before?.searchParams.get('limit')).toBe('1');
    expect(before?.searchParams.has('compare')).toBe(false);
  });

  it('sends the engines of the scope when a subset is asked', async () => {
    const seen = recordRequests();
    serveChanges();
    renderWith(<ChangesProbe name="a" />, 'cmp=off&engine=gemini_web');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ready ready');
    });
    for (const url of [...to(seen, '/sources/changes'), ...to(seen, '/sources/domains')]) {
      expect(url.searchParams.get('filter[engine_code_in]')).toBe('gemini_web');
    }
  });

  it('asks nothing and is idle when no engine is on', async () => {
    const seen = recordRequests();
    renderWith(<ChangesProbe name="a" />, '', 'cleanstart');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle idle no-before no_engine');
    });
    expect(to(seen, '/sources/changes')).toHaveLength(0);
  });

  it('asks nothing for branded prompts alone', async () => {
    const seen = recordRequests();
    renderWith(<ChangesProbe name="a" />, 'branded=only');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle idle no-before branded_only');
    });
    expect(to(seen, '/sources/changes')).toHaveLength(0);
  });
});

describe('useSourceDiversity', () => {
  it('asks for the weekly series, without a role, and is one request for two cards', async () => {
    const seen = recordRequests();
    server.use(
      http.get(DIVERSITY, () =>
        HttpResponse.json(
          diversityRead([diversityEngine('chatgpt_web', { weeks: [diversityWeek('2026-10-19', 5, 3, 2)] })]),
        ),
      ),
    );
    renderWith(
      <>
        <DiversityProbe name="a" />
        <DiversityProbe name="b" />
      </>,
      'cmp=off',
    );
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ready ok');
      expect(screen.getByTestId('b')).toHaveTextContent('ready ok');
    });
    const reads = to(seen, '/sources/diversity');
    expect(reads).toHaveLength(1);
    expect(reads[0]?.searchParams.get('include')).toBe('series');
    expect(reads[0]?.searchParams.has('filter[domain_role_in]')).toBe(false);
    expect(reads[0]?.searchParams.has('include_unresolved_redirects')).toBe(false);
  });

  it('asks nothing when no engine is on', async () => {
    const seen = recordRequests();
    renderWith(<DiversityProbe name="a" />, '', 'cleanstart');
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('idle no_engine');
    });
    expect(to(seen, '/sources/diversity')).toHaveLength(0);
  });
});
