// Setup of both test projects: the MSW server with every mock handler (src/mocks), as in `all` mode. A
// request no handler answers fails the test, so a test cannot pass by reaching something real. A test
// overrides a route with `server.use(...)`; handlers, the mocks' memory and the mock cookies are reset after
// each test.
import { afterAll, afterEach, beforeAll } from 'vitest';

import { MOCK_COOKIES } from './src/mocks/session';
import { resetMockState } from './src/mocks/state';
import { TEST_API_ORIGIN } from './src/test/api-server';
import { EXPIRE_COOKIE_PATH, server } from './src/test/msw';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(async () => {
  server.resetHandlers();
  resetMockState();
  // MSW keeps a mocked Set-Cookie in its own cookie jar (and, in jsdom, in document.cookie). An answer that
  // expires a mock cookie clears it in both, so no test starts signed in, registered or renamed because of
  // the one before it.
  const origin = typeof document === 'undefined' ? TEST_API_ORIGIN : window.location.origin;
  for (const name of MOCK_COOKIES) {
    await fetch(new URL(`${EXPIRE_COOKIE_PATH}/${name}`, origin), { method: 'POST' });
  }
});
afterAll(() => server.close());
