import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { createServerApi, serverApi } from './server';
import { newRequestId } from '@/lib/request-id';
import { TEST_API_ORIGIN, setupApiServer } from '@/test/api-server';

const server = setupApiServer();

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: (): Promise<Headers> => Promise.resolve(incoming.headers) }));
vi.mock('@/lib/env/server', () => ({ serverEnv: () => ({ API_INTERNAL_ORIGIN: 'http://api.test' }) }));

/** Sends the requests of `send` and returns what the API received, one entry per request. */
async function received(send: () => Promise<unknown>): Promise<Request[]> {
  const requests: Request[] = [];
  server.use(
    http.get(`${TEST_API_ORIGIN}/api/v1/*`, ({ request }) => {
      requests.push(request);
      return HttpResponse.json({ data: {} });
    }),
  );
  await send();
  return requests;
}

const PAGE_ID = newRequestId();
const pageRequest = (id: string = PAGE_ID): Headers =>
  new Headers({
    cookie: '__Host-session=abc; theme=dark',
    'x-request-id': id,
    authorization: 'Bearer stolen',
    'x-forwarded-for': '203.0.113.9',
    'accept-language': 'de',
  });

describe('createServerApi', () => {
  it('forwards the cookie and the request id, and nothing else of the page request', async () => {
    const client = createServerApi(pageRequest(), TEST_API_ORIGIN);
    const [request] = await received(() => client.GET('/api/v1/me'));
    expect(request?.headers.get('cookie')).toBe('__Host-session=abc; theme=dark');
    expect(request?.headers.get('x-request-id')).toBe(PAGE_ID);
    for (const name of ['authorization', 'x-forwarded-for', 'accept-language']) {
      expect(request?.headers.get(name), name).toBeNull();
    }
  });

  it('never uses a cache', async () => {
    const client = createServerApi(pageRequest(), TEST_API_ORIGIN);
    const [request] = await received(() => client.GET('/api/v1/me'));
    expect(request?.cache).toBe('no-store');
  });

  it('sends no cookie when the page request had none', async () => {
    const client = createServerApi(new Headers({ authorization: 'Bearer stolen' }), TEST_API_ORIGIN);
    const [request] = await received(() => client.GET('/api/v1/me'));
    expect(request?.headers.get('cookie')).toBeNull();
    expect(request?.headers.get('authorization')).toBeNull();
  });

  it('gives a render without a valid id one id of its own, the same for all its calls', async () => {
    const client = createServerApi(pageRequest('req_made_up_by_the_browser'), TEST_API_ORIGIN);
    const requests = await received(async () => {
      await client.GET('/api/v1/me');
      await client.GET('/api/v1/workspaces');
    });
    const ids = requests.map((request) => request.headers.get('x-request-id'));
    expect(ids[0]).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ids[0]).not.toBe('req_made_up_by_the_browser');
    expect(ids[1]).toBe(ids[0]);
  });
});

describe('serverApi', () => {
  it('calls the internal origin with the headers of the request being rendered', async () => {
    incoming.headers = pageRequest();
    const client = await serverApi();
    const [request] = await received(() => client.GET('/api/v1/me'));
    expect(request?.url).toBe(`${TEST_API_ORIGIN}/api/v1/me`);
    expect(request?.headers.get('cookie')).toBe('__Host-session=abc; theme=dark');
    expect(request?.headers.get('authorization')).toBeNull();
  });
});
