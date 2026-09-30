import { createApiClient, type ApiClient } from '@/lib/api/client';

/**
 * The origin unit tests send API requests to. Nothing listens there: the MSW server of vitest.msw.ts answers
 * every request, its handlers match any origin, and `server.use(...)` from '@/test/msw' overrides one.
 */
export const TEST_API_ORIGIN = 'http://api.test';

/** A client for unit tests: the browser client's base is the page's origin, which Node does not have. */
export const testApi = (): ApiClient => createApiClient({ baseUrl: TEST_API_ORIGIN });
