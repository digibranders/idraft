import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCitationCountries } from './citation-country';
import { makeQueryClient } from '@/lib/api/query-client';
import { promptTextsQuery } from '@/lib/citations/prompt-texts-query';
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

describe('useCitationCountries', () => {
  it('lists the countries of the prompts of the project, named, once each', async () => {
    const { result } = renderHook(() => useCitationCountries(source, null), { wrapper });
    // The Fynix prompts are set in Germany and in India
    await waitFor(() => expect(result.current.isos).toEqual(['DE', 'IN']));
    expect(result.current.nameOf('DE')).toBe('Germany');
    expect(result.current.nameOf('IN')).toBe('India');
  });

  it('keeps the selected country, and writes a code the list does not know as it is', async () => {
    const { result } = renderHook(() => useCitationCountries(source, 'ZZ'), { wrapper });
    await waitFor(() => expect(result.current.isos).toEqual(['DE', 'IN', 'ZZ']));
    expect(result.current.nameOf('ZZ')).toBe('ZZ');
  });

  it('a failed read leaves only the selected country', async () => {
    server.use(http.get(PROMPTS, ({ request }) => problem(request, 'not_found')));
    const none = renderHook(() => useCitationCountries(source, null), { wrapper });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(none.result.current.isos).toEqual([]);
    const chosen = renderHook(() => useCitationCountries(source, 'DE'), { wrapper });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(chosen.result.current.isos).toEqual(['DE']);
  });

  it('reads the prompts once for the whole page: the key is the one the no-own-page card reads', async () => {
    const { result } = renderHook(() => useCitationCountries(source, null), { wrapper });
    await waitFor(() => expect(result.current.isos.length).toBeGreaterThan(0));
    expect(client.getQueryData(promptTextsQuery(source).queryKey)).toBeDefined();
  });
});
