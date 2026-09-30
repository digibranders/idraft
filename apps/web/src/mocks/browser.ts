import { setupWorker } from 'msw/browser';

import { handlersFor, unhandledStrategy, type MockMode } from './handlers';

let starting: Promise<void> | undefined;

/**
 * Starts the MSW service worker (public/mockServiceWorker.js) and resolves once it intercepts requests,
 * so the first request of the page is already mocked. It is never imported when mocking is off.
 *
 * The start happens once per page: React's strict mode runs the caller's effect twice, and a second start
 * would attach every handler a second time, so each request would run its handler twice (a lock after 3
 * wrong passwords instead of 5).
 */
export function startWorker(mode: MockMode): Promise<void> {
  starting ??= setupWorker(...handlersFor(mode))
    .start({
      onUnhandledRequest: unhandledStrategy(mode),
      serviceWorker: { url: '/mockServiceWorker.js' },
      // One line per mocked request would bury the app's own console output
      quiet: true,
    })
    .then(() => undefined);
  return starting;
}
