import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { pageRange, useCursorPaging } from './cursor-paging';

describe('pageRange (decision W6)', () => {
  it('numbers the rows of the page shown', () => {
    expect(pageRange({ pageIndex: 0, rows: 100, limit: 100 })).toEqual({ from: 1, to: 100, offset: 0 });
    expect(pageRange({ pageIndex: 2, rows: 17, limit: 100 })).toEqual({ from: 201, to: 217, offset: 200 });
    expect(pageRange({ pageIndex: 0, rows: 0, limit: 100 })).toEqual({ from: 0, to: 0, offset: 0 });
  });
});

describe('useCursorPaging', () => {
  it('starts on the first page, walks forward by cursor and back to the cursor before', () => {
    const { result } = renderHook(() => useCursorPaging('q'));
    expect(result.current).toMatchObject({ cursor: null, pageIndex: 0, size: 100 });
    act(() => result.current.next('c1'));
    act(() => result.current.next('c2'));
    expect(result.current).toMatchObject({ cursor: 'c2', pageIndex: 2 });
    act(() => result.current.previous());
    expect(result.current).toMatchObject({ cursor: 'c1', pageIndex: 1 });
  });

  it('never goes before the first page', () => {
    const { result } = renderHook(() => useCursorPaging('q'));
    act(() => result.current.previous());
    expect(result.current).toMatchObject({ cursor: null, pageIndex: 0 });
  });

  it('starts again at the first page for a new query and keeps the page size', () => {
    const { result, rerender } = renderHook(({ key }) => useCursorPaging(key), { initialProps: { key: 'a' } });
    act(() => result.current.setSize(200));
    act(() => result.current.next('c1'));
    expect(result.current).toMatchObject({ cursor: 'c1', pageIndex: 1, size: 200 });
    rerender({ key: 'b' });
    expect(result.current).toMatchObject({ cursor: null, pageIndex: 0, size: 200 });
  });

  it('goes back to the first page when the page size changes', () => {
    const { result } = renderHook(() => useCursorPaging('q'));
    act(() => result.current.next('c1'));
    act(() => result.current.setSize(200));
    expect(result.current).toMatchObject({ cursor: null, pageIndex: 0, size: 200 });
  });
});
