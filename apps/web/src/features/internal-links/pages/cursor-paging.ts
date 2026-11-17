'use client';

import { useCallback, useState } from 'react';

import type { PageSize } from '@/components/app/data-table/types';

/** The rows of the page shown as the pager names them: "Showing 201 to 217". */
export function pageRange({ pageIndex, rows, limit }: { pageIndex: number; rows: number; limit: number }): {
  from: number;
  to: number;
  offset: number;
} {
  const offset = pageIndex * limit;
  return rows === 0 ? { from: 0, to: 0, offset: 0 } : { from: offset + 1, to: offset + rows, offset };
}

interface PagingState {
  key: string;
  cursors: (string | null)[];
  size: PageSize;
  /** The crawl the rows shown come from, once known: a cursor belongs to one crawl. */
  run: string | null;
}

/** The state for `key`: itself, or the first page of a new query with the same page size. */
const freshFor = (state: PagingState, key: string): PagingState =>
  state.key === key ? state : { key, cursors: [null], size: state.size, run: null };

/**
 * Previous and Next over a cursor-paged list (decision W6): the cursors of the pages seen are a stack, so Previous
 * returns to the cursor before. A new query (`resetKey`) starts again at the first page, and so does a new crawl
 * (`noteRun` with the run id the rows carry): a cursor of one crawl is refused by the API for the next (400
 * `invalid_cursor`), so the cursors in hand are dropped. `reset` is the same step for a refused cursor.
 */
export function useCursorPaging(resetKey: string): {
  cursor: string | null;
  pageIndex: number;
  size: PageSize;
  next: (cursor: string) => void;
  previous: () => void;
  setSize: (size: PageSize) => void;
  reset: () => void;
  noteRun: (run: string | null) => void;
} {
  const [state, setState] = useState<PagingState>({ key: resetKey, cursors: [null], size: 100, run: null });
  const current = freshFor(state, resetKey);
  const next = useCallback(
    (cursor: string) =>
      setState((before) => {
        const base = freshFor(before, resetKey);
        return { ...base, cursors: [...base.cursors, cursor] };
      }),
    [resetKey],
  );
  const previous = useCallback(
    () =>
      setState((before) => {
        const base = freshFor(before, resetKey);
        return { ...base, cursors: base.cursors.length > 1 ? base.cursors.slice(0, -1) : base.cursors };
      }),
    [resetKey],
  );
  const setSize = useCallback(
    (size: PageSize) => setState({ key: resetKey, cursors: [null], size, run: null }),
    [resetKey],
  );
  const reset = useCallback(
    () =>
      setState((before) => {
        const base = freshFor(before, resetKey);
        return base.cursors.length === 1 ? base : { ...base, cursors: [null] };
      }),
    [resetKey],
  );
  const noteRun = useCallback(
    (run: string | null) =>
      setState((before) => {
        const base = freshFor(before, resetKey);
        if (run === null || run === base.run) return base;
        // The first crawl seen is the one the cursors will come from; a different one drops them
        return { ...base, run, cursors: base.run === null ? base.cursors : [null] };
      }),
    [resetKey],
  );
  return {
    cursor: current.cursors.at(-1) ?? null,
    pageIndex: current.cursors.length - 1,
    size: current.size,
    next,
    previous,
    setSize,
    reset,
    noteRun,
  };
}
