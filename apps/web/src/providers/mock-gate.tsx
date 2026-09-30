'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type { MockMode } from '@/mocks/handlers';

/** How long the page waits for the worker before it renders anyway. */
const START_TIMEOUT_MS = 10_000;

/**
 * Starts the MSW worker before the app renders, so the first request of the page is already answered by a
 * mock. Rendered by `AppProviders` only when NEXT_PUBLIC_API_MOCKING is not `off`; with mocking on, nothing
 * inside it is rendered on the server, so the server and the first client render agree.
 *
 * The import of the worker sits inside a check of the inlined variable, so a build with mocking off drops
 * it, and msw never reaches a production bundle. A worker that fails or hangs is reported and the app
 * renders anyway: its API calls then fail loudly on their own.
 */
export function MockGate({ mode, children }: { mode: MockMode; children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const giveUp = setTimeout(() => {
      console.error(`The API mocks did not start within ${String(START_TIMEOUT_MS / 1000)} seconds`);
      if (active) setReady(true);
    }, START_TIMEOUT_MS);
    if (process.env.NEXT_PUBLIC_API_MOCKING !== 'off') {
      import('@/mocks/browser')
        .then(({ startWorker }) => startWorker(mode))
        .catch((error: unknown) => {
          console.error('The API mocks could not start', error);
        })
        .finally(() => {
          clearTimeout(giveUp);
          if (active) setReady(true);
        });
    }
    return () => {
      active = false;
      clearTimeout(giveUp);
    };
  }, [mode]);
  return ready ? children : null;
}
