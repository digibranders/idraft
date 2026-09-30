import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { api, unwrap } from './client';
import { setupApiServer } from '@/test/api-server';

const server = setupApiServer();

/*
 * The browser client in a DOM: its base is the page's origin (http://localhost:3000 under jsdom), so the
 * component tests of later tasks can reach MSW with the client the app ships.
 */
describe('the browser client', () => {
  it('sends a same-origin request with a request id', async () => {
    let received: { url: string; id: string | null } | null = null;
    server.use(
      http.get(`${window.location.origin}/api/v1/me`, ({ request }) => {
        received = { url: request.url, id: request.headers.get('x-request-id') };
        return HttpResponse.json({ data: { user: { name: 'Ana Brandt' } } });
      }),
    );
    await expect(unwrap(api.GET('/api/v1/me'))).resolves.toMatchObject({ data: { user: { name: 'Ana Brandt' } } });
    expect(received).toEqual({
      url: `${window.location.origin}/api/v1/me`,
      id: expect.stringMatching(/^req_/) as unknown,
    });
  });
});
