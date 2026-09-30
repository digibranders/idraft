'use client';

import { createContext, use, useMemo } from 'react';

import { isApiProblem } from '@/lib/api/problem';

/** Asks the person to confirm it is them; resolves `true` once they did, `false` when they cancelled. */
export type ConfirmIdentity = () => Promise<boolean>;

/**
 * Wraps a request that may need a fresh session (24-security.md section 2): when the API answers
 * `403 fresh_session_required`, the person confirms it is them and the request is sent again, once. A
 * second `fresh_session_required` is not looped on: it reaches the caller. Cancelling rejects with the
 * first problem, which the caller treats as "nothing happened".
 */
export function withFreshSession<TArgs extends unknown[], TResult>(
  confirm: ConfirmIdentity,
  request: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    try {
      return await request(...args);
    } catch (error) {
      if (!isApiProblem(error, 'fresh_session_required')) throw error;
      if (!(await confirm())) throw error;
      return request(...args);
    }
  };
}

/** How the page asks the person to confirm: provided by the workspace's `FreshSessionProvider`. */
export const ConfirmContext = createContext<ConfirmIdentity | null>(null);

export type WithFreshSession = <TArgs extends unknown[], TResult>(
  request: (...args: TArgs) => Promise<TResult>,
) => (...args: TArgs) => Promise<TResult>;

/**
 * `withFreshSession` bound to the page's dialog: `mutationFn: withFresh(apiMutation(...).mutationFn)`.
 * Only below the `[workspace]` layout, where `FreshSessionProvider` is.
 */
export function useFreshSession(): WithFreshSession {
  const confirm = use(ConfirmContext);
  if (confirm === null) throw new Error('useFreshSession is used outside a FreshSessionProvider');
  return useMemo<WithFreshSession>(() => (request) => withFreshSession(confirm, request), [confirm]);
}
