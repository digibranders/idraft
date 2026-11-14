'use client';

import { useMemo } from 'react';

import { isApiProblem } from '@/lib/api/problem';

/**
 * One status vocabulary for every read of the Competitors page, as the AI Overview has for its own (a feature may
 * not import another; follow-up F-1 of the plan lifts both into `lib`). A section reads a `Read` and never a query
 * result. Nothing here turns a read that failed or did not run into a number: `data` is `undefined` then, and
 * unknown is never zero.
 */

/**
 * - `idle`: the read does not run for this scope (another tab is open, or nothing is asked of it): nothing to wait for.
 * - `loading`: asked, or waiting for what it must ask first, and nothing to show yet.
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
  /** The data is the last that was read: a later read of it failed. The section says so and keeps showing it. */
  stale: boolean;
  /**
   * The data is the last scope's, kept while this scope is read (`keepPreviousData`), not data of this scope: a
   * refetch of the same scope has it `false`. Only a read that has data can have it.
   */
  placeholder: boolean;
  /** Reads again; does nothing for an `idle` read. */
  refetch: () => void;
}

/**
 * Whether a read runs: `waiting` is `loading` for a read that must first learn what to ask from another one;
 * `paused` is a read that could run and has been asked not to: it shows the data it already has for this scope, if
 * any, and is `idle` otherwise. It never asks and never fails.
 */
export type Gate = 'run' | 'idle' | 'waiting' | 'paused';

/** The part of a query result a read is made from. */
export interface QueryLike<T> {
  data: T | undefined;
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  /** The data is that of the previous key, kept while this one is read: not data of this scope. */
  isPlaceholderData?: boolean;
  refetch: () => unknown;
}

export function useRead<T>(
  { data, error, isError, isFetching, isPlaceholderData = false, refetch }: QueryLike<T>,
  requested: Gate = 'run',
): Read<T> {
  return useMemo((): Read<T> => {
    // A paused read shows what it has for this scope; with nothing (or the data of an earlier scope) it is idle
    const gate: Gate = requested === 'paused' && (data === undefined || isPlaceholderData) ? 'idle' : requested;
    const retry = (): void => {
      if (gate === 'run') void refetch();
    };
    if (gate === 'idle' || gate === 'waiting') {
      return {
        status: gate === 'idle' ? 'idle' : 'loading',
        data: undefined,
        errorId: null,
        stale: false,
        placeholder: false,
        refetch: retry,
      };
    }
    const errorId = isError && isApiProblem(error) ? error.requestId : null;
    if (data === undefined) {
      // A retry under way is a read under way, not the failure it follows
      const status = isError && !isFetching ? 'error' : 'loading';
      return { status, data: undefined, errorId, stale: false, placeholder: false, refetch: retry };
    }
    return {
      status: isFetching ? 'refetching' : 'ready',
      data,
      errorId,
      stale: isError,
      placeholder: isPlaceholderData,
      refetch: retry,
    };
  }, [data, error, isError, isFetching, isPlaceholderData, refetch, requested]);
}
