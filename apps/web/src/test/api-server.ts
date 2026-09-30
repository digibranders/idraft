import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { createApiClient, type ApiClient } from '@/lib/api/client';

/** The origin tests send API requests to. Nothing listens there: MSW answers every request. */
export const TEST_API_ORIGIN = 'http://api.test';

/** A client for tests: the browser client's base is the page's origin, which Node does not have. */
export const testApi = (): ApiClient => createApiClient({ baseUrl: TEST_API_ORIGIN });

type ApiServer = ReturnType<typeof setupServer>;

/**
 * An MSW server for the calling test file, started before its tests and reset after each. A request no
 * handler answers fails the test, so a test cannot pass by reaching something real.
 */
export function setupApiServer(): ApiServer {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}
