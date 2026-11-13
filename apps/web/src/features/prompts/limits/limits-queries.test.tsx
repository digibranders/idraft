import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { aiLimitsQuery, useAiLimits } from './limits-queries';
import { aiKey, bulkArchive, refreshPrompts, type PromptScope } from '../prompt-queries';
import { makeQueryClient } from '@/lib/api/query-client';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS, PROMPT_QUOTA } from '@/mocks/prompt-fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix fixture project is missing');
const scope: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const FIRST = FIXTURE_PROMPTS.get(fynix.project_id)?.[0]?.prompt_id ?? '';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('useAiLimits', () => {
  it('reads the prompts of the workspace and the manual runs of the project from the limits route', async () => {
    const { result } = renderHook(() => useAiLimits(scope), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.prompts).toEqual({ limit: PROMPT_QUOTA, used: 24 });
    expect(result.current.data?.data.manual_runs_today).toEqual({ limit: 20, used: 0 });
  });

  it('sits under the AI reads of the project, so a prompt change reads it again', async () => {
    expect(aiLimitsQuery(scope).queryKey.slice(0, 5)).toEqual(aiKey(scope));
    const { result } = renderHook(() => useAiLimits(scope), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.prompts.used).toBe(24);
    await bulkArchive(scope, [FIRST], true);
    await refreshPrompts(client, scope);
    await waitFor(() => expect(result.current.data?.data.prompts.used).toBe(23));
  });

  it('is an error, not zeros, when the limits could not be read', async () => {
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/ai/limits', () =>
        HttpResponse.json({ code: 'forbidden' }, { status: 403 }),
      ),
    );
    const { result } = renderHook(() => useAiLimits(scope), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
