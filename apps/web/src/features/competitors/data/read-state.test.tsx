import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRead, type QueryLike } from './read-state';
import { ApiProblem } from '@/lib/api/problem';

const query = <T,>(over: Partial<QueryLike<T>> = {}): QueryLike<T> => ({
  data: undefined,
  error: null,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  ...over,
});

const read = <T,>(like: QueryLike<T>, gate?: Parameters<typeof useRead>[1]): ReturnType<typeof useRead<T>> =>
  renderHook(() => useRead(like, gate)).result.current;

describe('useRead', () => {
  it('is idle when the read does not run for this scope, with no data and no error', () => {
    expect(read(query({ data: 1 }), 'idle')).toMatchObject({ status: 'idle', data: undefined, stale: false });
  });

  it('is loading while it waits for another read, and while it is asked with nothing to show', () => {
    expect(read(query(), 'waiting').status).toBe('loading');
    expect(read(query({ isFetching: true })).status).toBe('loading');
    expect(read(query()).status).toBe('loading');
  });

  it('is ready with data, refetching while another read of it is under way', () => {
    expect(read(query({ data: 7 }))).toMatchObject({ status: 'ready', data: 7, stale: false, placeholder: false });
    expect(read(query({ data: 7, isFetching: true })).status).toBe('refetching');
  });

  it('is an error with nothing to show, carrying the request id, and loading while its retry runs', () => {
    const error = new ApiProblem({
      status: 500,
      code: 'internal',
      title: 'Failed',
      detail: null,
      requestId: 'req-1',
      errors: [],
      retryAfterSeconds: null,
      body: {},
    });
    expect(read(query({ isError: true, error }))).toMatchObject({ status: 'error', errorId: 'req-1', data: undefined });
    expect(read(query({ isError: true, error, isFetching: true })).status).toBe('loading');
  });

  it('is stale when a later read failed and the data is kept', () => {
    const error = new Error('lost');
    expect(read(query({ data: 7, isError: true, error }))).toMatchObject({
      status: 'ready',
      data: 7,
      stale: true,
      errorId: null,
    });
  });

  it("flags placeholder data as another scope's", () => {
    expect(read(query({ data: 7, isFetching: true, isPlaceholderData: true }))).toMatchObject({
      status: 'refetching',
      placeholder: true,
    });
  });

  it('a paused read shows the data it has for this scope, and is idle otherwise', () => {
    expect(read(query({ data: 7 }), 'paused')).toMatchObject({ status: 'ready', data: 7 });
    expect(read(query({ data: 7, isPlaceholderData: true }), 'paused').status).toBe('idle');
    expect(read(query(), 'paused').status).toBe('idle');
  });

  it('refetch asks again only while the read runs', () => {
    const refetch = vi.fn();
    read(query({ data: 1, refetch }), 'run').refetch();
    read(query({ data: 1, refetch }), 'idle').refetch();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
