import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_COUNTRY_PROMPTS, usePromptCountries } from './prompt-countries';
import { makeQueryClient } from '@/lib/api/query-client';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const PROJECT = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const PROMPTS = `*/api/v1/workspaces/:w/projects/:p/prompts`;
const PROMPT_ID = '11111111-1111-4111-8111-111111111111';

/** A prompt as the API sends it, with the market it asks in. */
const promptRow = (country: string | null): Record<string, unknown> => ({
  prompt_id: PROMPT_ID,
  current_version: { version_no: 1, change_kind: 'initial', text: 'Which agency?', created_at: '2026-11-01T00:00:00Z' },
  country_iso: country,
  language_code: 'en',
  is_branded: false,
  is_active: true,
  intent: 'unknown',
  funnel_stage: 'unknown',
  prompt_type: 'question',
  importance: 3,
  source: 'human',
  creation_method: 'human',
  created_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  terms: [],
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('usePromptCountries', () => {
  it('lists the countries the prompts carry, sorted, plus the chosen one', async () => {
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json({
          data: [promptRow('IN'), promptRow('DE'), promptRow('DE'), promptRow(null)],
          page: { has_more: false, next_cursor: null, limit: 200 },
        }),
      ),
    );
    const { result } = renderHook(() => usePromptCountries(PROJECT, 'FR'), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.data).toEqual(['DE', 'FR', 'IN']);
    expect(result.current.complete).toBe(true);
  });

  it('lists only the countries of the prompts when no country is chosen or the chosen one is carried', async () => {
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json({ data: [promptRow('DE')], page: { has_more: false, next_cursor: null, limit: 200 } }),
      ),
    );
    const { result } = renderHook(() => usePromptCountries(PROJECT, 'DE'), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.data).toEqual(['DE']);
  });

  it('reads pages of 200 until the list is whole', async () => {
    const asked: { cursor: string | null; limit: string | null }[] = [];
    server.use(
      http.get(PROMPTS, ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        asked.push({ cursor, limit: url.searchParams.get('limit') });
        return HttpResponse.json(
          cursor === null
            ? { data: [promptRow('DE')], page: { has_more: true, next_cursor: 'second', limit: 200 } }
            : { data: [promptRow('IN')], page: { has_more: false, next_cursor: null, limit: 200 } },
        );
      }),
    );
    const { result } = renderHook(() => usePromptCountries(PROJECT, null), { wrapper });
    await waitFor(() => {
      expect(result.current.complete).toBe(true);
    });
    expect(asked).toEqual([
      { cursor: null, limit: '200' },
      { cursor: 'second', limit: '200' },
    ]);
    expect(result.current.data).toEqual(['DE', 'IN']);
  });

  it('stops at 1000 prompts however many pages the API has', async () => {
    let pages = 0;
    server.use(
      http.get(PROMPTS, () => {
        pages += 1;
        return HttpResponse.json({
          data: Array.from({ length: 200 }, () => promptRow('DE')),
          page: { has_more: true, next_cursor: `page-${String(pages)}`, limit: 200 },
        });
      }),
    );
    const { result } = renderHook(() => usePromptCountries(PROJECT, null), { wrapper });
    await waitFor(() => {
      expect(result.current.complete).toBe(true);
    });
    expect(MAX_COUNTRY_PROMPTS).toBe(1000);
    expect(pages).toBe(5);
    expect(result.current.data).toEqual(['DE']);
  });

  it('is subscribed when the option is left out or undefined, as before', async () => {
    let asked = 0;
    server.use(
      http.get(PROMPTS, () => {
        asked += 1;
        return HttpResponse.json({ data: [promptRow('DE')], page: { has_more: false, next_cursor: null, limit: 200 } });
      }),
    );
    const { result } = renderHook(() => usePromptCountries(PROJECT, null, { subscribed: undefined }), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(asked).toBe(1);
  });

  it('reports a failed first page as an error with Retry, and no countries', async () => {
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Internal error',
            status: 500,
            code: 'internal_error',
            request_id: 'req-countries',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { result } = renderHook(() => usePromptCountries(PROJECT, null), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.errorId).toBe('req-countries');
  });
});

/** Lets a request that would have been sent on a render reach the server, so "none" is a fact and not a race. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 30);
    });
  });

describe('the subscribed option of usePromptCountries', () => {
  const onePage = (country: string, counter: { asked: number }): void => {
    server.use(
      http.get(PROMPTS, () => {
        counter.asked += 1;
        return HttpResponse.json({
          data: [promptRow(country)],
          page: { has_more: false, next_cursor: null, limit: 200 },
        });
      }),
    );
  };

  it('makes no request while paused, and is idle with no countries, never loading or error', async () => {
    const counter = { asked: 0 };
    onePage('DE', counter);
    const { result } = renderHook(() => usePromptCountries(PROJECT, 'FR', { subscribed: false }), { wrapper });
    await settle();
    expect(counter.asked).toBe(0);
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(result.current.errorId).toBeNull();
    expect(result.current.complete).toBe(false);
  });

  it('reads the first page once when it subscribes', async () => {
    const counter = { asked: 0 };
    onePage('DE', counter);
    const { result, rerender } = renderHook(
      (props: { subscribed: boolean }) => usePromptCountries(PROJECT, null, { subscribed: props.subscribed }),
      { wrapper, initialProps: { subscribed: false } },
    );
    await settle();
    rerender({ subscribed: true });
    await waitFor(() => {
      expect(result.current.complete).toBe(true);
    });
    await settle();
    expect(counter.asked).toBe(1);
    expect(result.current.data).toEqual(['DE']);
  });

  it('keeps the countries it has when paused and asks for nothing more', async () => {
    const counter = { asked: 0 };
    onePage('DE', counter);
    const { result, rerender } = renderHook(
      (props: { subscribed: boolean }) => usePromptCountries(PROJECT, null, { subscribed: props.subscribed }),
      { wrapper, initialProps: { subscribed: true } },
    );
    await waitFor(() => {
      expect(result.current.complete).toBe(true);
    });
    const before = result.current.data;
    rerender({ subscribed: false });
    await settle();
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe(before);
    expect(result.current.complete).toBe(true);
    expect(counter.asked).toBe(1);
  });

  it('never turns a paused read into an error: a failing API is not asked, and is reported once it is', async () => {
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Internal error',
            status: 500,
            code: 'internal_error',
            request_id: 'req-paused',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { result, rerender } = renderHook(
      (props: { subscribed: boolean }) => usePromptCountries(PROJECT, null, { subscribed: props.subscribed }),
      { wrapper, initialProps: { subscribed: false } },
    );
    await settle();
    expect(result.current.status).toBe('idle');
    expect(result.current.errorId).toBeNull();
    rerender({ subscribed: true });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.errorId).toBe('req-paused');
  });
});
