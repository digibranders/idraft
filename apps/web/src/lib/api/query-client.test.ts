import { MutationObserver, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiMutation, apiQuery } from './query';
import { getQueryClient, isSignedOut, loginUrl, makeQueryClient } from './query-client';
import { retryDelay, shouldRetry, shouldRetryMutation } from './retry';
import { TEST_API_ORIGIN, testApi } from '@/test/api-server';
import { server } from '@/test/msw';

const W = '0192d1a8-7e8b-7c3a-9f3e-3b5a2c1d4e5f';

function problem(status: number, code: string, headers: Record<string, string> = {}): HttpResponse<string> {
  const body = { type: 'about:blank', title: code, status, code, instance: '/api/v1/me', request_id: 'req_1' };
  return new HttpResponse(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

/** Answers GET /me with `responses` in turn, then with the last one; returns how many requests came. */
function answerMe(...responses: (() => Response)[]): { count: () => number } {
  let count = 0;
  server.use(
    http.get(`${TEST_API_ORIGIN}/api/v1/me`, () => {
      count += 1;
      const respond = responses[Math.min(count, responses.length) - 1];
      if (!respond) throw new Error('no response given');
      return respond();
    }),
  );
  return { count: () => count };
}

const me = apiQuery('/api/v1/me', { client: testApi() });
const settle = (client: QueryClient): Promise<unknown> => client.fetchQuery(me).catch((error: unknown) => error);

describe('makeQueryClient', () => {
  it('does not retry on the server or in tests, and keeps configuration fresh for 30 seconds', () => {
    const client = makeQueryClient();
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });

  it('uses the retry policy when retries are on, as in the browser', () => {
    const options = makeQueryClient({ retry: true }).getDefaultOptions();
    expect(options.queries?.retry).toBe(shouldRetry);
    expect(options.queries?.retryDelay).toBe(retryDelay);
    expect(options.mutations?.retry).toBe(shouldRetryMutation);
  });
});

describe('the error policy', () => {
  it.each(['unauthenticated', 'session_expired'])('empties the cache and signs out on a 401 %s', async (code) => {
    const onSignedOut = vi.fn(() => true);
    const client = makeQueryClient({ onSignedOut });
    client.setQueryData(['ws', W, 'projects', {}], { data: [] });
    answerMe(() => problem(401, code));
    await settle(client);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['ws', W, 'projects', {}])).toBeUndefined();
  });

  it('leaves the page once, however many requests find the session gone', async () => {
    const onSignedOut = vi.fn(() => true);
    const client = makeQueryClient({ onSignedOut });
    answerMe(() => problem(401, 'session_expired'));
    server.use(http.get(`${TEST_API_ORIGIN}/api/v1/workspaces`, () => problem(401, 'session_expired')));
    const workspaces = apiQuery('/api/v1/workspaces', { client: testApi() });
    await Promise.all([settle(client), client.fetchQuery(workspaces).catch(() => undefined)]);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('keeps the policy on while a public page stays, so a later lost session still signs out', async () => {
    const stays = [false, true];
    const onSignedOut = vi.fn(() => stays.shift() ?? true);
    const client = makeQueryClient({ onSignedOut });
    answerMe(() => problem(401, 'unauthenticated'));
    await settle(client);
    client.setQueryData(['ws', W, 'projects', {}], { data: [] });
    await client.fetchQuery({ ...me, queryKey: ['me', 'again'] }).catch(() => undefined);
    expect(onSignedOut).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(['ws', W, 'projects', {}])).toBeUndefined();
  });

  it('signs out when a write finds the session gone', async () => {
    const onSignedOut = vi.fn(() => true);
    const client = makeQueryClient({ onSignedOut });
    server.use(http.post(`${TEST_API_ORIGIN}/api/v1/auth/sign-out`, () => problem(401, 'session_expired')));
    const signOut = new MutationObserver(client, apiMutation('post', '/api/v1/auth/sign-out', { client: testApi() }));
    await signOut.mutate(undefined).catch(() => undefined);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('leaves any other 401 to the screen: a wrong password is not a lost session', async () => {
    const onSignedOut = vi.fn(() => true);
    const client = makeQueryClient({ onSignedOut });
    client.setQueryData(['kept'], 1);
    answerMe(() => problem(401, 'invalid_credentials'));
    await settle(client);
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(client.getQueryData(['kept'])).toBe(1);
  });

  it('waits Retry-After, then asks a 429 once more', async () => {
    const requests = answerMe(
      () => problem(429, 'rate_limited', { 'retry-after': '0' }),
      () => HttpResponse.json({ data: {} }),
    );
    await expect(makeQueryClient({ retry: true }).fetchQuery(me)).resolves.toEqual({ data: {} });
    expect(requests.count()).toBe(2);
  });

  it('asks a 429 only once more, even if it is refused again', async () => {
    const requests = answerMe(() => problem(429, 'rate_limited', { 'retry-after': '0' }));
    await settle(makeQueryClient({ retry: true }));
    expect(requests.count()).toBe(2);
  });

  it.each([
    [400, 'bad_request'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [422, 'validation_failed'],
  ])('never retries a %i', async (status, code) => {
    const requests = answerMe(() => problem(status, code));
    await settle(makeQueryClient({ retry: true }));
    expect(requests.count()).toBe(1);
  });

  it('retries a 5xx twice', async () => {
    const requests = answerMe(() => problem(503, 'service_unavailable', { 'retry-after': '0' }));
    await settle(makeQueryClient({ retry: true }));
    expect(requests.count()).toBe(3);
  });

  it('sends a write again once after a 409 conflict, and never after anything else', async () => {
    let conflicts = 0;
    server.use(
      http.patch(`${TEST_API_ORIGIN}/api/v1/workspaces/:workspaceId`, () => {
        conflicts += 1;
        return conflicts === 1 ? problem(409, 'conflict', { 'retry-after': '0' }) : HttpResponse.json({ data: {} });
      }),
    );
    const client = makeQueryClient({ retry: true });
    const rename = new MutationObserver(
      client,
      apiMutation('patch', '/api/v1/workspaces/{workspace_id}', { client: testApi() }),
    );
    await rename.mutate({ params: { path: { workspace_id: W } }, body: { name: 'Digibranders' } });
    expect(conflicts).toBe(2);

    let refusals = 0;
    server.use(
      http.patch(`${TEST_API_ORIGIN}/api/v1/workspaces/:workspaceId`, () => {
        refusals += 1;
        return problem(409, 'duplicate');
      }),
    );
    await rename
      .mutate({ params: { path: { workspace_id: W } }, body: { name: 'Digibranders' } })
      .catch(() => undefined);
    expect(refusals).toBe(1);
  });
});

describe('signing out in the browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function browserAt(pathname: string, search = ''): { pathname: string; assign: ReturnType<typeof vi.fn> } {
    const location = { pathname, search, assign: vi.fn() };
    vi.stubGlobal('window', { location });
    return location;
  }

  it('loads the sign-in page, told where to come back to', async () => {
    const location = browserAt('/digibranders/fynix/rankings', '?loc=2840&dev=mobile');
    answerMe(() => problem(401, 'unauthenticated'));
    await settle(makeQueryClient({ retry: false }));
    expect(location.assign).toHaveBeenCalledWith(
      '/login?next=%2Fdigibranders%2Ffynix%2Frankings%3Floc%3D2840%26dev%3Dmobile',
    );
  });

  it.each(['/login', '/two-factor', '/reset-password'])(
    'stays on the public page %s, which handles the answer',
    async (path) => {
      const location = browserAt(path, '?next=%2Fsettings');
      answerMe(() => problem(401, 'unauthenticated'));
      await settle(makeQueryClient({ retry: false }));
      expect(location.assign).not.toHaveBeenCalled();
    },
  );

  it('still signs out after a 401 on the sign-in page once the person has moved on without a reload', async () => {
    const location = browserAt('/login');
    const client = makeQueryClient({ retry: false });
    answerMe(() => problem(401, 'unauthenticated'));
    await settle(client);
    location.pathname = '/digibranders';
    await client.fetchQuery({ ...me, queryKey: ['me', 'after sign-in'] }).catch(() => undefined);
    expect(location.assign).toHaveBeenCalledWith('/login?next=%2Fdigibranders');
  });
});

describe('helpers', () => {
  it('tells a lost session from other errors', () => {
    expect(isSignedOut(new Error('unauthenticated'))).toBe(false);
    expect(loginUrl({ pathname: '/settings/security', search: '' })).toBe('/login?next=%2Fsettings%2Fsecurity');
  });

  it('gives every request its own client on the server, so one person never sees another person’s cache', () => {
    expect(getQueryClient()).not.toBe(getQueryClient());
  });
});
