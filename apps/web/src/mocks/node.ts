import { setupServer } from 'msw/node';

import { handlersFor, unhandledStrategy, type MockMode } from './handlers';

/**
 * Starts MSW in the Next.js server process, for the requests Server Components send to the API
 * (src/instrumentation.ts). It is never imported when mocking is off. The tests have their own server
 * (src/test/msw.ts).
 */
export function startMockServer(mode: MockMode): void {
  setupServer(...handlersFor(mode)).listen({ onUnhandledRequest: unhandledStrategy(mode) });
}
