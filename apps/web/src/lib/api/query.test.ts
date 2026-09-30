import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { ApiProblem } from './problem';
import { apiMutation, apiQuery, type ApiResponse } from './query';
import type { Me } from './types';
import { TEST_API_ORIGIN, testApi } from '@/test/api-server';
import { server } from '@/test/msw';

const W = '0192d1a8-7e8b-7c3a-9f3e-3b5a2c1d4e5f';
const PROBLEM_JSON = { 'content-type': 'application/problem+json' };

const client = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/*
 * Type-level checks. They are compiled by `pnpm typecheck`, not run: several of them are calls that must not
 * compile, and would throw if they ran. Each `@ts-expect-error` fails the typecheck when its line compiles.
 */
const PROJECTS = '/api/v1/workspaces/{workspace_id}/projects';
const WORKSPACE = '/api/v1/workspaces/{workspace_id}';

export function typeChecks(): void {
  // @ts-expect-error: no such GET path
  apiQuery('/api/v1/nowhere');
  // @ts-expect-error: sign-in is a POST
  apiQuery('/api/v1/auth/sign-in');
  // @ts-expect-error: health checks are not called from pages
  apiQuery('/api/healthz');
  // @ts-expect-error: the workspace id is required
  apiQuery(PROJECTS);
  // @ts-expect-error: the path parameter is missing
  apiQuery(PROJECTS, { params: { path: {} } });
  // @ts-expect-error: an undeclared query parameter
  apiQuery(PROJECTS, { params: { path: { workspace_id: W }, query: { limit: 10, page: 2 } } });
  // @ts-expect-error: an option that would change the response without changing its type or key
  apiQuery('/api/v1/me', { parseAs: 'text' });
  // @ts-expect-error: no PUT on this path
  apiMutation('put', WORKSPACE);
  const rename = new MutationObserver(new QueryClient(), apiMutation('patch', WORKSPACE));
  // @ts-expect-error: a name is text
  void rename.mutate({ params: { path: { workspace_id: W } }, body: { name: 1 } });
  // @ts-expect-error: the base URL is the client's, not the request's
  void rename.mutate({ params: { path: { workspace_id: W } }, body: {}, baseUrl: 'http://elsewhere.test' });
}

describe('apiQuery types', () => {
  it('types the response of a path', () => {
    const me = apiQuery('/api/v1/me');
    expectTypeOf(me.queryFn).returns.resolves.toEqualTypeOf<ApiResponse<'get', '/api/v1/me'>>();
    expectTypeOf<ApiResponse<'get', '/api/v1/me'>['data']>().toEqualTypeOf<Me>();
    expectTypeOf<ApiResponse<'post', '/api/v1/auth/sign-out'>>().toEqualTypeOf<undefined>();
    expectTypeOf(apiQuery(PROJECTS, { params: { path: { workspace_id: W } } }).queryKey).toMatchTypeOf<
      readonly unknown[]
    >();
  });

  it('types the variables of a mutation as the parameters and body of the request', () => {
    const rename = apiMutation('patch', WORKSPACE);
    expectTypeOf(rename.mutationFn)
      .parameter(0)
      .toMatchTypeOf<{ params: { path: { workspace_id: string } }; body: { name?: string } }>();
  });
});

describe('apiQuery', () => {
  it('derives the key from the path and the query, and resolves with the body', async () => {
    const body = { data: [], page: { offset: 0, limit: 10, total: 0 } };
    let url = '';
    server.use(
      http.get(`${TEST_API_ORIGIN}/api/v1/workspaces/:workspaceId/projects`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(body);
      }),
    );
    const options = apiQuery('/api/v1/workspaces/{workspace_id}/projects', {
      params: { path: { workspace_id: W }, query: { limit: 10, offset: 0, 'filter[status_in]': ['active', 'paused'] } },
      defaults: { offset: 0 },
      client: testApi(),
    });
    expect(options.queryKey).toEqual(['ws', W, 'projects', { 'filter[status_in]': ['active', 'paused'], limit: 10 }]);
    await expect(client().fetchQuery(options)).resolves.toEqual(body);
    // What the key holds is what is sent: the default is left out of both. Lists go once, comma-separated,
    // and the client adds no parameter of its own
    const sent = new URL(url);
    expect([...sent.searchParams.keys()].sort()).toEqual(['filter[status_in]', 'limit']);
    expect(sent.searchParams.get('filter[status_in]')).toBe('active,paused');
  });

  it('sends a request id in the format of the API', async () => {
    let id: string | null = null;
    server.use(
      http.get(`${TEST_API_ORIGIN}/api/v1/me`, ({ request }) => {
        id = request.headers.get('x-request-id');
        return HttpResponse.json({ data: {} });
      }),
    );
    await client().fetchQuery(apiQuery('/api/v1/me', { client: testApi() }));
    expect(id).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('turns a 2xx that is not JSON into an http_error, not a lost connection', async () => {
    server.use(
      http.get(
        `${TEST_API_ORIGIN}/api/v1/me`,
        () => new HttpResponse('<html>Sign in to the hotel Wi-Fi</html>', { headers: { 'content-type': 'text/html' } }),
      ),
    );
    await expect(client().fetchQuery(apiQuery('/api/v1/me', { client: testApi() }))).rejects.toMatchObject({
      status: 200,
      code: 'http_error',
    });
  });

  it('refuses to use the browser client on the server, where it has no origin', async () => {
    await expect(client().fetchQuery(apiQuery('/api/v1/me'))).rejects.toThrow('pass client: await serverApi()');
  });

  it('rejects with an ApiProblem carrying the code of a problem response', async () => {
    server.use(
      http.get(`${TEST_API_ORIGIN}/api/v1/me`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not signed in',
            status: 401,
            code: 'unauthenticated',
            instance: '/api/v1/me',
            request_id: 'req_1',
          },
          { status: 401, headers: PROBLEM_JSON },
        ),
      ),
    );
    const error: unknown = await client()
      .fetchQuery(apiQuery('/api/v1/me', { client: testApi() }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiProblem);
    expect(error).toMatchObject({ status: 401, code: 'unauthenticated', requestId: 'req_1' });
  });

  it('rejects with an http_error for a response that is not problem JSON', async () => {
    server.use(
      http.get(`${TEST_API_ORIGIN}/api/v1/me`, () => new HttpResponse('<html>Bad Gateway</html>', { status: 502 })),
    );
    await expect(client().fetchQuery(apiQuery('/api/v1/me', { client: testApi() }))).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
    });
  });

  it('passes the abort signal on, so a cancelled query cancels its request', async () => {
    let arrived: () => void = () => undefined;
    const arrival = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let aborted = false;
    server.use(
      http.get(`${TEST_API_ORIGIN}/api/v1/me`, async ({ request }) => {
        const abort = new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve();
          request.signal.addEventListener('abort', () => resolve());
        });
        arrived();
        await abort;
        aborted = request.signal.aborted;
        return HttpResponse.json({});
      }),
    );
    const queryClient = client();
    const options = apiQuery('/api/v1/me', { client: testApi() });
    const pending = queryClient.fetchQuery(options).catch((caught: unknown) => caught);
    await arrival;
    await queryClient.cancelQueries({ queryKey: options.queryKey });
    await pending;
    await expect.poll(() => aborted).toBe(true);
  });
});

describe('apiMutation', () => {
  it('sends the path parameters and the body, and resolves with the response body', async () => {
    let received: unknown = null;
    const workspace = { data: { workspace_id: W, name: 'Digibranders' } };
    server.use(
      http.patch(`${TEST_API_ORIGIN}/api/v1/workspaces/:workspaceId`, async ({ request, params }) => {
        received = { id: params.workspaceId, body: await request.json() };
        return HttpResponse.json(workspace);
      }),
    );
    const rename = new MutationObserver(
      client(),
      apiMutation('patch', '/api/v1/workspaces/{workspace_id}', { client: testApi() }),
    );
    const result = await rename.mutate({ params: { path: { workspace_id: W } }, body: { name: 'Digibranders' } });
    expect(received).toEqual({ id: W, body: { name: 'Digibranders' } });
    expect(result).toEqual(workspace);
  });

  it('resolves a 204 with no body', async () => {
    server.use(http.post(`${TEST_API_ORIGIN}/api/v1/auth/sign-out`, () => new HttpResponse(null, { status: 204 })));
    const signOut = new MutationObserver(client(), apiMutation('post', '/api/v1/auth/sign-out', { client: testApi() }));
    await expect(signOut.mutate(undefined)).resolves.toBeUndefined();
  });

  it('rejects with the ApiProblem of a refused write', async () => {
    server.use(
      http.patch(`${TEST_API_ORIGIN}/api/v1/workspaces/:workspaceId`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            code: 'workspace_suspended',
            instance: '/',
            request_id: 'r',
          },
          { status: 403, headers: PROBLEM_JSON },
        ),
      ),
    );
    const rename = new MutationObserver(
      client(),
      apiMutation('patch', '/api/v1/workspaces/{workspace_id}', { client: testApi() }),
    );
    await expect(
      rename.mutate({ params: { path: { workspace_id: W } }, body: { name: 'Digibranders' } }),
    ).rejects.toMatchObject({ status: 403, code: 'workspace_suspended' });
  });
});
