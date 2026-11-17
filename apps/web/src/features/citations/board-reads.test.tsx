import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useBoardEngines, useCitedPages, useTracked } from './board-reads';
import messages from '../../../messages/en.json';
import { makeQueryClient } from '@/lib/api/query-client';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const PROJECT = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };

// The wrapper of `features/citations/citation-reads.test.tsx`: the catalog and a query cache of the test's own
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </NextIntlClientProvider>
);

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('the Citations reads', () => {
  it('lists the enabled engines in code order with their labels', async () => {
    const { result } = renderHook(() => useBoardEngines(PROJECT), { wrapper });
    await waitFor(() => expect(result.current.engines).not.toBeNull());
    expect(result.current.engines?.map((engine) => engine.code)).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('lists the tracked competitors in Settings order and the own brand', async () => {
    const { result } = renderHook(() => useTracked(PROJECT), { wrapper });
    await waitFor(() => expect(result.current.tracked).not.toBeNull());
    expect(result.current.tracked).toHaveLength(5);
    expect(result.current.ownName).toBe('Fynix');
  });

  it('reads Cited pages 200 at a time and the next page on demand', async () => {
    const { result } = renderHook(
      () =>
        useCitedPages(
          PROJECT,
          { runs: 4, engines: ['chatgpt_web'], term: null },
          { role: null, q: '', sort: '-citations' },
          true,
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    expect(result.current.total).toBe(CITATIONS_FIXTURE.expected.chatgpt.pages.all);
    result.current.loadMore();
    await waitFor(() => expect(result.current.rows).toHaveLength(CITATIONS_FIXTURE.expected.chatgpt.pages.all));
  });
});
