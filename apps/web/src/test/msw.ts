import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { handlers } from '@/mocks/handlers';
import { expiredCookie } from '@/mocks/session';

/**
 * A route of the tests only: its answer expires the mock cookie it names (vitest.msw.ts calls it for each
 * one after every test). One cookie per answer: MSW reads a single `Set-Cookie` from a mocked response.
 */
export const EXPIRE_COOKIE_PATH = '/__test/expire-cookie';

const expireCookie = http.post<{ name: string }>(
  `*${EXPIRE_COOKIE_PATH}/:name`,
  ({ params }) => new HttpResponse(null, { status: 204, headers: { 'set-cookie': expiredCookie(params.name) } }),
);

/**
 * The MSW server of the tests, with every mock handler as in `all` mode (vitest.msw.ts starts and resets
 * it). A test overrides a route with `server.use(...)`.
 */
export const server = setupServer(...handlers, expireCookie);
