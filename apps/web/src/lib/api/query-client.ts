import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { isApiProblem } from './problem';
import { retryDelay, shouldRetry, shouldRetryMutation } from './retry';
import { isPublicPath } from '@/lib/routes/public-paths';

/** Configuration data goes stale after 30 seconds; analytics queries set their own 5 minutes (20 section 3.5). */
const CONFIGURATION_STALE_MS = 30_000;
const LOGIN_PATH = '/login';

/**
 * Marks the sign-out mutation (`meta: { [SIGN_OUT_META]: true }`): a 401 it gets means the person is
 * signed out already, and it must not send them to sign in with the page they left in `next`.
 */
export const SIGN_OUT_META = 'signOut';

/** The codes of a 401 that mean the session is gone, as opposed to a wrong password (19 section 2.7). */
const SIGNED_OUT_CODES: ReadonlySet<string> = new Set(['unauthenticated', 'session_expired']);

export function isSignedOut(error: unknown): boolean {
  return isApiProblem(error) && error.status === 401 && SIGNED_OUT_CODES.has(error.code);
}

/** The sign-in page, told to come back to `location` afterwards. */
export function loginUrl(location: Pick<Location, 'pathname' | 'search'>): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}

/**
 * A full page load of the sign-in page, so nothing of the signed-out session stays in memory. Not from a
 * public page (the sign-in page, the second factor, a reset link), which handles that answer itself: the
 * sign-in page may ask who is signed in and hear that nobody is. Returns whether the page is being left.
 */
function goToLogin(): boolean {
  const { location } = window;
  if (isPublicPath(location.pathname)) return false;
  location.assign(loginUrl(location));
  return true;
}

export interface QueryClientOptions {
  /**
   * Retries follow ./retry.ts when on. Off on the server and in tests: a retry waits before it asks
   * again, which on the server would hold the page while the API is down, and in a test would bring the
   * error state after the test stopped waiting. On by default in the browser.
   */
  retry?: boolean;
  /**
   * What happens once the session is found to be gone, after the cache is emptied; returns whether the
   * page is being left. In the browser: a full load of the sign-in page, except from a public page.
   */
  onSignedOut?: () => boolean;
}

/**
 * The query client and the error policy every query and mutation shares (20 section 3.7). A 401 that means
 * the session is gone empties the cache and sends the person to sign in; everything else is left to the
 * screen that made the request. Once the page is being left, further 401s change nothing; a public page
 * that stays keeps the policy on, for when the person moves on without a reload.
 */
export function makeQueryClient({
  retry = typeof window !== 'undefined',
  onSignedOut = typeof window === 'undefined' ? undefined : goToLogin,
}: QueryClientOptions = {}): QueryClient {
  let leaving = false;
  const handleError = (error: unknown): void => {
    if (leaving || !isSignedOut(error)) return;
    client.clear();
    leaving = onSignedOut?.() ?? false;
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({
      // Signing out handles its own 401 (the session had ended already) and leaves for the sign-in page itself
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.[SIGN_OUT_META] !== true) handleError(error);
      },
    }),
    defaultOptions: {
      queries: { staleTime: CONFIGURATION_STALE_MS, retry: retry ? shouldRetry : false, retryDelay },
      // A write is sent again only after a 409 conflict, where the API wrote nothing
      mutations: { retry: retry ? shouldRetryMutation : false, retryDelay },
    },
  });
  return client;
}

let browserClient: QueryClient | null = null;

/**
 * One client for the life of the page in the browser. On the server every request gets its own, so one
 * person's cached data can never be rendered for another.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
