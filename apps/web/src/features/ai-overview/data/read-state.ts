'use client';

import { useMemo } from 'react';

import { isApiProblem } from '@/lib/api/problem';

/**
 * One status vocabulary for every read of the AI visibility Overview (WP-33 plan section 3.3). A card or the
 * strip reads a `Read` and never a query result, so the later swap of a read for the WP-32 aggregates changes
 * only the hooks behind it. Nothing here turns a read that failed or did not run into a number: `data` is
 * `undefined` then, and unknown is never zero.
 */

/**
 * - `idle`: the read does not run for this scope (no engine is on, the choice names no engine that is on, or the
 *   API cannot answer this scope): there is nothing to wait for, so no skeleton.
 * - `loading`: asked, nothing to show yet.
 * - `ready`: data to show; the last read of it may have failed (`stale`).
 * - `refetching`: data to show while a new read is under way (a scope change keeps the last data).
 * - `error`: the read failed and there is nothing to show.
 */
export type ReadStatus = 'idle' | 'loading' | 'ready' | 'refetching' | 'error';

export interface Read<T> {
  status: ReadStatus;
  data: T | undefined;
  /** The request id of a failed read, for support; `null` when it did not fail or the failure has none. */
  errorId: string | null;
  /** The data is the last that was read: a later read of it failed. The card says so and keeps showing it. */
  stale: boolean;
  /** Reads again; does nothing for an `idle` read. */
  refetch: () => void;
}

/** Whether a read runs: `waiting` is `loading` for a read that must first learn what to ask from another one. */
export type Gate = 'run' | 'idle' | 'waiting';

/** The part of a query result a read is made from (also made of the pages of an infinite query). */
export interface QueryLike<T> {
  data: T | undefined;
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

export function useRead<T>({ data, error, isError, isFetching, refetch }: QueryLike<T>, gate: Gate = 'run'): Read<T> {
  return useMemo((): Read<T> => {
    const retry = (): void => {
      if (gate !== 'idle') void refetch();
    };
    if (gate !== 'run') {
      return {
        status: gate === 'idle' ? 'idle' : 'loading',
        data: undefined,
        errorId: null,
        stale: false,
        refetch: retry,
      };
    }
    const errorId = isError && isApiProblem(error) ? error.requestId : null;
    if (data === undefined) {
      // A retry under way is a read under way, not the failure it follows
      const status = isError && !isFetching ? 'error' : 'loading';
      return { status, data: undefined, errorId, stale: false, refetch: retry };
    }
    return { status: isFetching ? 'refetching' : 'ready', data, errorId, stale: isError, refetch: retry };
  }, [data, error, isError, isFetching, refetch, gate]);
}

/** The same read with its data changed by `change`; absent data stays absent. */
export function mapRead<T, U>(read: Read<T>, change: (data: T) => U): Read<U> {
  return { ...read, data: read.data === undefined ? undefined : change(read.data) };
}
