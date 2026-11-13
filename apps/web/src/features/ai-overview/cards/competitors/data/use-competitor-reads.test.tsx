import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCompetitorReads, useTrackedSet, type ReadShape } from './use-competitor-reads';
import { OverviewProvider } from '../../../overview-context';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const PROJECT_PATH = '*/api/v1/workspaces/:w/projects/:p';
const SHAPES: readonly ReadShape[] = ['prompt-rows', 'totals', 'pairs', 'weekly'];

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
const summaries = (seen: readonly URL[]): URL[] => seen.filter((url) => url.pathname.endsWith('/ai/prompts-summary'));
const includeOf = (url: URL): string[] =>
  url.searchParams
    .getAll('include')
    .flatMap((value) => value.split(','))
    .sort();

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
});

function ReadProbe({ shape, name }: { shape: ReadShape; name: string }): ReactElement {
  const reads = useCompetitorReads(shape);
  return (
    <p
      data-testid={name}
    >{`${reads.current.status} ${reads.previous === null ? 'no-previous' : reads.previous.status}`}</p>
  );
}

function SetProbe(): ReactElement {
  const { current } = useCompetitorReads('totals');
  const set = useTrackedSet(current.data);
  return (
    <p data-testid="set">
      {set === null
        ? 'none'
        : set.entities
            .map((entity) => `${entity.role}:${String(entity.colorIndex)}:${String(entity.addedAt)}`)
            .join('|')}
    </p>
  );
}

function renderWith(ui: ReactElement, searchParams = ''): ReturnType<typeof renderWithProviders> {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <OverviewProvider
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        project={overviewProject('fynix')}
      >
        {ui}
      </OverviewProvider>
    </PermissionProvider>,
    { searchParams },
  );
}

describe('useCompetitorReads', () => {
  it('asks the include and rows of its shape, one request per shape', async () => {
    const seen = recordRequests();
    renderWith(
      <>
        {SHAPES.map((shape) => (
          <ReadProbe key={shape} shape={shape} name={shape} />
        ))}
      </>,
      'cmp=off',
    );
    await waitFor(() => {
      for (const shape of SHAPES) expect(screen.getByTestId(shape)).toHaveTextContent('ready');
    });
    const asked = summaries(seen);
    expect(asked).toHaveLength(4);
    const shapes = asked.map((url) => [includeOf(url).join(','), url.searchParams.get('rows')]);
    expect(shapes).toHaveLength(4);
    expect(shapes).toEqual(
      expect.arrayContaining([
        ['co_mentions,entities,total', 'none'],
        ['entities,series,total', 'none'],
        ['entities,total', null],
        ['entities,total', 'none'],
      ]),
    );
  });

  it('asks the prompt rows with no rows parameter', async () => {
    const seen = recordRequests();
    renderWith(<ReadProbe shape="prompt-rows" name="rows" />, 'cmp=off');
    await waitFor(() => {
      expect(screen.getByTestId('rows')).toHaveTextContent('ready');
    });
    const [request] = summaries(seen);
    expect(includeOf(request as URL)).toEqual(['entities', 'total']);
    expect(request?.searchParams.has('rows')).toBe(false);
  });

  it('makes one request for two cards of one shape', async () => {
    const seen = recordRequests();
    renderWith(
      <>
        <ReadProbe shape="weekly" name="first" />
        <ReadProbe shape="weekly" name="second" />
      </>,
      'cmp=off',
    );
    await waitFor(() => {
      expect(screen.getByTestId('first')).toHaveTextContent('ready');
      expect(screen.getByTestId('second')).toHaveTextContent('ready');
    });
    expect(summaries(seen)).toHaveLength(1);
  });

  it('asks the previous window as a second read of the same shape while the comparison is on', async () => {
    const seen = recordRequests();
    renderWith(<ReadProbe shape="totals" name="totals" />);
    await waitFor(() => {
      expect(screen.getByTestId('totals')).toHaveTextContent('ready ready');
    });
    const asked = summaries(seen);
    expect(asked).toHaveLength(2);
    expect(new Set(asked.map((url) => url.searchParams.get('from'))).size).toBe(2);
    for (const url of asked) {
      expect(includeOf(url)).toEqual(['entities', 'total']);
      expect(url.searchParams.get('rows')).toBe('none');
    }
  });

  it('asks no previous window with the comparison off', async () => {
    const seen = recordRequests();
    renderWith(<ReadProbe shape="totals" name="totals" />, 'cmp=off');
    await waitFor(() => {
      expect(screen.getByTestId('totals')).toHaveTextContent('ready no-previous');
    });
    expect(summaries(seen)).toHaveLength(1);
  });
});

describe('useTrackedSet', () => {
  it('is none until the summary is in, then gives color_index, added_at and role from the entities read', async () => {
    renderWith(<SetProbe />, 'cmp=off');
    expect(screen.getByTestId('set')).toHaveTextContent('none');
    await waitFor(() => {
      const text = screen.getByTestId('set').textContent;
      expect(text).toMatch(/^own:1:\d{4}-/);
    });
    const entries = (screen.getByTestId('set').textContent ?? '').split('|');
    expect(entries.length).toBeGreaterThan(1);
    expect(entries[0]).toMatch(/^own:1:/);
    for (const entry of entries.slice(1)) expect(entry).toMatch(/^competitor:[2-6]:\d{4}-/);
  });

  it('leaves the set without dates when the entities read fails, and the card reads on', async () => {
    server.use(
      http.get(`${PROJECT_PATH}/entities`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req-e' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { queryClient } = renderWith(
      <>
        <SetProbe />
        <ReadProbe shape="totals" name="totals" />
      </>,
      'cmp=off',
    );
    await waitFor(() => {
      expect(screen.getByTestId('totals')).toHaveTextContent('ready');
      expect(screen.getByTestId('set').textContent).toMatch(/^own:null:null/);
    });
    await waitFor(() => {
      expect(
        queryClient
          .getQueryCache()
          .getAll()
          .some((query) => query.state.status === 'error'),
      ).toBe(true);
    });
    const entries = (screen.getByTestId('set').textContent ?? '').split('|');
    expect(entries.length).toBeGreaterThan(1);
    for (const entry of entries) expect(entry).toMatch(/^(own|competitor):null:null$/);
    expect(screen.getByTestId('totals')).toHaveTextContent('ready');
  });
});
