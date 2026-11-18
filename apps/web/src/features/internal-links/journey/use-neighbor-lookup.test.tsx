import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { useNeighborLookup, useNeighborVersion } from './use-neighbor-lookup';
import { READ_LIMIT, type ListRequest } from '@/lib/internal-links/journey-layout';
import { neighborsQuery } from '@/lib/internal-links/queries';
import type { LinksScope, NeighborList } from '@/lib/internal-links/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { neighborsOf } from '@/mocks/internal-links-world';
import { renderWithProviders } from '@/test/render';

const SCOPE: LinksScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: MOCK_PROJECTS[0]?.project_id ?? '' };
const FOCUS = '101';
const REQUEST = (pages: number): ListRequest => ({ urlId: FOCUS, direction: 'out', scope: 'editorial', pages });

function listOf(total: number): NeighborList {
  return {
    data: neighborsOf(FOCUS, 'out', 'editorial'),
    meta: {
      run_id: 'run',
      url_id: FOCUS,
      direction: 'out',
      scope: 'editorial',
      total,
      other_scopes: [],
      focus: { url_id: FOCUS, status_code: 200, redirect_url_id: null },
    },
  };
}
const keyOf = (offset: number): readonly unknown[] =>
  neighborsQuery(SCOPE, { urlId: FOCUS, direction: 'out', linkScope: 'editorial', offset }).queryKey;

/** Shows what the lookup answers for a request, and the version the hook counts. */
function Probe({
  pages,
  seed,
  run = null,
}: {
  pages: number;
  seed: (client: QueryClient) => void;
  run?: string | null;
}): ReactElement {
  const client = useQueryClient();
  // Once, before the first read
  useState(() => {
    seed(client);
    return null;
  });
  const { lookup } = useNeighborLookup(SCOPE, run);
  const version = useNeighborVersion(SCOPE);
  const list = lookup(REQUEST(pages));
  return (
    <p data-testid="out">
      {JSON.stringify({
        status: list.status,
        items: list.items.length,
        total: list.total,
        partial: list.partial ?? false,
        version,
      })}
    </p>
  );
}
const read = (): { status: string; items: number; total: number; partial: boolean; version: number } =>
  JSON.parse(screen.getByTestId('out').textContent ?? '{}');

const full = neighborsOf(FOCUS, 'out', 'editorial').length;

describe('useNeighborLookup', () => {
  it('keeps the pages that have arrived while a later page is missing, and says more is on its way', () => {
    renderWithProviders(<Probe pages={2} seed={(client) => client.setQueryData(keyOf(0), listOf(READ_LIMIT + 10))} />);
    expect(read()).toMatchObject({ status: 'ready', items: full, total: READ_LIMIT + 10, partial: true });
  });

  it('is loading only while the first page is missing', () => {
    renderWithProviders(<Probe pages={2} seed={() => undefined} />);
    expect(read()).toMatchObject({ status: 'loading', items: 0 });
  });

  it('is failed only when the first page failed: a failed later page keeps the rows that loaded', () => {
    renderWithProviders(
      <Probe
        pages={2}
        seed={(client) => {
          client.setQueryData(keyOf(0), listOf(READ_LIMIT + 10));
          client
            .getQueryCache()
            .build(client, { queryKey: keyOf(READ_LIMIT) })
            .setState({ status: 'error', error: new Error('down'), data: undefined });
        }}
      />,
    );
    expect(read()).toMatchObject({ status: 'ready', items: full, partial: true });

    renderWithProviders(
      <Probe
        pages={1}
        seed={(client) =>
          client
            .getQueryCache()
            .build(client, { queryKey: keyOf(0) })
            .setState({ status: 'error', error: new Error('down'), data: undefined })
        }
      />,
    );
    expect(screen.getAllByTestId('out').map((node) => JSON.parse(node.textContent ?? '{}').status)).toContain('error');
  });

  it('reads the lists of the chosen crawl, which have their own cache keys, and never the latest crawl lists', () => {
    const RUN = '0192e4a0-1000-7000-8000-000000000003';
    const runKey = neighborsQuery(
      SCOPE,
      { urlId: FOCUS, direction: 'out', linkScope: 'editorial', offset: 0 },
      RUN,
    ).queryKey;
    const seed = (client: QueryClient): void => {
      client.setQueryData(runKey, listOf(full));
    };
    renderWithProviders(<Probe pages={1} seed={seed} run={RUN} />);
    expect(read()).toMatchObject({ status: 'ready', items: full });
    renderWithProviders(<Probe pages={1} seed={seed} />);
    expect(screen.getAllByTestId('out').map((node) => JSON.parse(node.textContent ?? '{}').status)).toContain(
      'loading',
    );
  });

  it('is ready and whole when every page is there', () => {
    renderWithProviders(<Probe pages={1} seed={(client) => client.setQueryData(keyOf(0), listOf(full))} />);
    expect(read()).toMatchObject({ status: 'ready', items: full, total: full, partial: false });
  });
});

describe('useNeighborVersion', () => {
  it('counts a list arriving and nothing else', async () => {
    const { queryClient } = renderWithProviders(<Probe pages={1} seed={() => undefined} />);
    expect(read().version).toBe(0);
    queryClient.setQueryData(['ws', SCOPE.workspaceId, 'p', SCOPE.projectId, 'internal-links', 'pages', {}], {});
    queryClient.setQueryData(['unrelated'], 1);
    await Promise.resolve();
    expect(read().version).toBe(0);
    queryClient.setQueryData(keyOf(0), listOf(full));
    expect(await screen.findByText(/"version":1/)).toBeInTheDocument();
  });
});
