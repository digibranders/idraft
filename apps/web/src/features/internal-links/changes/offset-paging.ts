'use client';

import { useCallback, useState } from 'react';

import type { PageSize } from '@/components/app/data-table/types';

/** The next page's first row, or `null` when this page reaches the end. */
export const nextOffset = (offset: number, limit: number, total: number): number | null =>
  offset + limit < total ? offset + limit : null;

/** The previous page's first row, or `null` on the first page. */
export const previousOffset = (offset: number, limit: number): number | null =>
  offset > 0 ? Math.max(0, offset - limit) : null;

/** The rows of a page as the pager names them ("Showing 101 to 150 of 250"); zeros for none. */
export const rangeOf = (offset: number, count: number, total: number): { from: number; to: number; total: number } =>
  count === 0 ? { from: 0, to: 0, total } : { from: offset + 1, to: offset + count, total };

interface PagingState {
  key: string;
  offset: number;
  size: PageSize;
}

/** Offset paging of a list the API pages by `offset` and `limit`; a new `resetKey` starts again at the first page. */
export function useOffsetPaging(resetKey: string): {
  offset: number;
  size: PageSize;
  next: (total: number) => void;
  previous: () => void;
  setSize: (size: PageSize) => void;
  reset: () => void;
} {
  const [state, setState] = useState<PagingState>({ key: resetKey, offset: 0, size: 100 });
  const current: PagingState = state.key === resetKey ? state : { key: resetKey, offset: 0, size: state.size };
  const next = useCallback(
    (total: number) =>
      setState((before) => {
        const base: PagingState = before.key === resetKey ? before : { key: resetKey, offset: 0, size: before.size };
        return { ...base, offset: nextOffset(base.offset, base.size, total) ?? base.offset };
      }),
    [resetKey],
  );
  const previous = useCallback(
    () =>
      setState((before) => {
        const base: PagingState = before.key === resetKey ? before : { key: resetKey, offset: 0, size: before.size };
        return { ...base, offset: previousOffset(base.offset, base.size) ?? 0 };
      }),
    [resetKey],
  );
  const setSize = useCallback((size: PageSize) => setState({ key: resetKey, offset: 0, size }), [resetKey]);
  const reset = useCallback(() => setState((before) => ({ key: resetKey, offset: 0, size: before.size })), [resetKey]);
  return { offset: current.offset, size: current.size, next, previous, setSize, reset };
}
