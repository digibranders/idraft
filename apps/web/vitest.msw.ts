// Setup of both test projects: the MSW server with every mock handler (src/mocks), as in `all` mode. A
// request no handler answers fails the test, so a test cannot pass by reaching something real. A test
// overrides a route with `server.use(...)`; handlers, the mocks' memory and the mock session are reset after
// each test.
import { afterAll, afterEach, beforeAll } from 'vitest';

import { resetMockState } from './src/mocks/state';
import { server } from './src/test/msw';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(async () => {
  server.resetHandlers();
  resetMockState();
  // In jsdom, MSW writes a mocked Set-Cookie to document.cookie and to its own cookie jar. Signing out
  // through the mocks expires both, so no test starts signed in because of the one before it.
  if (typeof document !== 'undefined') {
    await fetch(new URL('/api/v1/auth/sign-out', window.location.origin), { method: 'POST' });
  }
});
afterAll(() => server.close());
