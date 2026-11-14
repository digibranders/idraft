import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePromptCountries } from './prompt-countries';
import { makeQueryClient } from '@/lib/api/query-client';
import type { SourceScope } from '@/lib/citations/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture project is missing');
const source: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const PROMPTS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts');
const NOW = Date.parse('2026-11-12T12:00:00Z');

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(NOW + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePromptCountries', () => {
  it('lists the countries of the first 200 prompts, named, once each', async () => {
    const { result } = renderHook(() => usePromptCountries(source, null), { wrapper });
    await waitFor(() => expect(result.current.isos).toEqual(['DE', 'IN']));
    expect(result.current.nameOf('DE')).toBe('Germany');
  });

  it("keeps a link's country, and writes a code the list does not know as it is", async () => {
    const { result } = renderHook(() => usePromptCountries(source, 'ZZ'), { wrapper });
    await waitFor(() => expect(result.current.isos).toEqual(['DE', 'IN', 'ZZ']));
    expect(result.current.nameOf('ZZ')).toBe('ZZ');
  });

  it('draws nothing when there is none: a failed read with no country chosen lists no country', async () => {
    server.use(http.get(PROMPTS, ({ request }) => problem(request, 'not_found')));
    const none = renderHook(() => usePromptCountries(source, null), { wrapper });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(none.result.current.isos).toEqual([]);
    const chosen = renderHook(() => usePromptCountries(source, 'DE'), { wrapper });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(chosen.result.current.isos).toEqual(['DE']);
  });
});
