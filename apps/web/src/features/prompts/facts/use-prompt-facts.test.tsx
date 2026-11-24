import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { factsRequested, promptFactsQuery, usePromptFacts } from './use-prompt-facts';
import type { PromptScope } from '../prompt-queries';
import { makeQueryClient } from '@/lib/api/query-client';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const scope: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const RANGE = { from: '2026-10-16', to: '2026-11-12' };

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** The summary requests the page made, by the `include` they carried. */
function recordSummaryReads(): string[] {
  const reads: string[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ai/prompts-summary')) reads.push(url.searchParams.get('include') ?? '');
  });
  return reads;
}

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

afterEach(() => {
  server.events.removeAllListeners();
});

describe('usePromptFacts', () => {
  it('reads every row and its facts in one summary read, never one per row', async () => {
    const reads = recordSummaryReads();
    const { result } = renderHook(() => usePromptFacts(scope, RANGE, true, { requestFacts: true }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reads).toEqual(['entities,facts,ai_overview']);
    const facts = result.current.data;
    expect(facts?.requested).toBe(true);
    expect(facts?.prompts.size).toBeGreaterThan(20);
    expect(facts?.entities.length).toBeGreaterThan(0);
    const [first] = [...(facts?.prompts.values() ?? [])];
    expect(first?.intent).toBeDefined();
    expect(first?.engines[0]?.position).toBeDefined();
    expect(facts?.topics.size).toBeGreaterThan(0);
  });

  it('asks for the plain summary with entities when the facts are not requested, and the rows then carry none', async () => {
    const reads = recordSummaryReads();
    const { result } = renderHook(() => usePromptFacts(scope, RANGE, true, { requestFacts: false }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reads).toEqual(['entities']);
    expect(result.current.data?.requested).toBe(false);
    const [first] = [...(result.current.data?.prompts.values() ?? [])];
    expect(first?.intent).toBeUndefined();
    expect(first?.engines[0]?.position).toBeUndefined();
  });

  it('indexes the summary once: a re-render gives the same facts object', async () => {
    const { result, rerender } = renderHook(() => usePromptFacts(scope, RANGE, true, { requestFacts: true }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const first = result.current.data;
    rerender();
    rerender();
    expect(result.current.data).toBe(first);
  });

  it('asks for the facts include by default, with the entities, the AI Overview and no weekly series', () => {
    expect(factsRequested()).toBe(true);
    expect(promptFactsQuery(scope, RANGE, true).queryKey.at(-1)).toMatchObject({
      include: ['entities', 'facts', 'ai_overview'],
    });
  });

  it('keys the two reads apart so one never serves the other', () => {
    expect(promptFactsQuery(scope, RANGE, true, { requestFacts: true }).queryKey).not.toEqual(
      promptFactsQuery(scope, RANGE, true, { requestFacts: false }).queryKey,
    );
  });
});
