import { afterEach, describe, expect, it, vi } from 'vitest';

import { startMockServer } from './node';
import { apiFetch, clearApiFetchOverride } from '@/lib/api/api-fetch';
import { createServerApi } from '@/lib/api/server';
import { mockUser } from './fixtures';
import { SESSION_COOKIE } from './session';

vi.mock('@/lib/env/server', () => ({ serverEnv: () => ({ API_INTERNAL_ORIGIN: 'http://api.internal' }) }));

const ORIGIN = 'http://api.internal';

describe('startMockServer', () => {
  afterEach(() => {
    clearApiFetchOverride();
    vi.restoreAllMocks();
  });

  it('answers the requests of the server client from the handlers, cookies included', async () => {
    startMockServer('all');
    const anonymous = createServerApi(new Headers(), ORIGIN);
    expect((await anonymous.GET('/api/v1/me')).response.status).toBe(401);
    const session = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.0`;
    const signedIn = createServerApi(new Headers({ cookie: session }), ORIGIN);
    const { data } = await signedIn.GET('/api/v1/me');
    expect(data?.data.user.email).toBe(mockUser('editor').email);
  });

  it('passes a request body on to the handlers', async () => {
    startMockServer('all');
    const client = createServerApi(new Headers(), ORIGIN);
    const { response, error } = await client.POST('/api/v1/auth/verify-email/request', {
      body: { email: 'mei@digibranders.test' },
    });
    expect(error).toBeUndefined();
    expect(response.status).toBe(202);
  });

  it('refuses a request no handler answers in all mode, naming it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    startMockServer('all');
    const response = await apiFetch(new Request(`${ORIGIN}/api/v1/nothing-here`));
    expect(response.status).toBe(404);
    expect(error).toHaveBeenCalledWith('[mocks] No handler for GET /api/v1/nothing-here');
  });

  it('passes a request no handler answers to the API in pending mode', async () => {
    const real = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    startMockServer('pending');
    const response = await apiFetch(new Request(`${ORIGIN}/api/v1/me`));
    expect(response.status).toBe(200);
    expect(real).toHaveBeenCalledTimes(1);
  });
});
