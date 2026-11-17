import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useBoardEngines, useCitedPage, useCitedPages, useGap, useGaps, useTracked } from './board-reads';
import messages from '../../../messages/en.json';
import { makeQueryClient } from '@/lib/api/query-client';
import type { BoardScopeParams } from '@/lib/citations/board-queries';
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

describe('the drawer and gap reads while the scope or the entity changes', () => {
  const SCOPE: BoardScopeParams = { runs: 4, engines: ['chatgpt_web'], term: null };
  const OTHER_SCOPE: BoardScopeParams = { ...SCOPE, runs: 2 };
  const TOP = CITATIONS_FIXTURE.expected.chatgpt.pages.topOwn;
  // The mock model numbers the fixture's pages from 1, in the order of `urls`
  const TOP_ID = CITATIONS_FIXTURE.urls.findIndex((url) => url.role === 'own' && url.path === TOP.path) + 1;
  const PROMPT_ID = CITATIONS_FIXTURE.prompts.find(
    (prompt) => prompt.text === CITATIONS_FIXTURE.expected.chatgpt.gaps.first,
  )?.id;
  const OTHER_PROMPT_ID = CITATIONS_FIXTURE.prompts.find((prompt) => prompt.id !== PROMPT_ID)?.id;

  async function competitorIds(): Promise<string[]> {
    const { result } = renderHook(() => useTracked(PROJECT), { wrapper });
    await waitFor(() => expect(result.current.tracked).not.toBeNull());
    return (result.current.tracked ?? []).map((competitor) => competitor.id);
  }

  it('keeps a page in view while its scope changes, and shows nothing of another page', async () => {
    const { result, rerender } = renderHook(({ scope, urlId }) => useCitedPage(PROJECT, scope, urlId), {
      wrapper,
      initialProps: { scope: SCOPE, urlId: TOP_ID },
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ scope: OTHER_SCOPE, urlId: TOP_ID });
    expect(result.current.data).toBeDefined();
    rerender({ scope: OTHER_SCOPE, urlId: TOP_ID + 1 });
    expect(result.current.data).toBeUndefined();
  });

  it('keeps a gap in view while its scope changes, and shows nothing of another prompt or competitor set', async () => {
    const [first, second, third] = await competitorIds();
    if (PROMPT_ID === undefined || OTHER_PROMPT_ID === undefined || first === undefined) throw new Error('No fixture');
    const { result, rerender } = renderHook(
      ({ scope, promptId, competitors }) => useGap(PROJECT, scope, competitors, promptId),
      { wrapper, initialProps: { scope: SCOPE, promptId: PROMPT_ID, competitors: [first, second ?? first] } },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ scope: OTHER_SCOPE, promptId: PROMPT_ID, competitors: [first, second ?? first] });
    expect(result.current.data).toBeDefined();
    rerender({ scope: OTHER_SCOPE, promptId: OTHER_PROMPT_ID, competitors: [first, second ?? first] });
    expect(result.current.data).toBeUndefined();
    rerender({ scope: OTHER_SCOPE, promptId: OTHER_PROMPT_ID, competitors: [third ?? first] });
    expect(result.current.data).toBeUndefined();
  });

  it('keeps the gap rows while the scope changes and drops them when the competitors change', async () => {
    const [first, second, third] = await competitorIds();
    if (first === undefined || second === undefined || third === undefined) throw new Error('No competitors');
    const { result, rerender } = renderHook(({ scope, competitors }) => useGaps(PROJECT, scope, competitors, true), {
      wrapper,
      initialProps: { scope: SCOPE, competitors: [first, second] },
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ scope: OTHER_SCOPE, competitors: [first, second] });
    expect(result.current.data).toBeDefined();
    rerender({ scope: OTHER_SCOPE, competitors: [first, second, third] });
    expect(result.current.data).toBeUndefined();
  });
});
