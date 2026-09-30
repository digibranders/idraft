import { getResponse } from 'msw';

import { handlersFor, type MockMode } from './handlers';
import { problem } from './respond';
import { overrideApiFetch } from '@/lib/api/api-fetch';

/**
 * Puts the mock handlers in front of the API requests Server Components send (src/instrumentation.ts). It
 * calls the handlers directly rather than intercepting `fetch`: Next.js wraps `fetch` with a version that
 * keeps the original it found, so an interceptor installed later never sees a request (../lib/api/api-fetch.ts).
 * It is never imported when mocking is off. The tests have their own server (src/test/msw.ts).
 *
 * A request no handler answers goes to the API in `pending` mode; in `all` mode it is an error, as the
 * browser's worker makes it, so a missing mock is noticed at once.
 */
export function startMockServer(mode: MockMode): void {
  const handlers = handlersFor(mode);
  overrideApiFetch(async (request) => {
    const mocked = await getResponse(handlers, request.clone());
    if (mocked !== undefined) return mocked;
    if (mode === 'pending') return fetch(request);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    console.error(`[mocks] No handler for ${route}`);
    return problem(request, 'not_found', { detail: `The mocks have no handler for ${route}.` });
  });
}
