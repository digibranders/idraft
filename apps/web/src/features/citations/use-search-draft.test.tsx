import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_DELAY_MS, useSearchDraft } from './use-search-draft';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the search draft', () => {
  it('keeps what is typed, spaces included, and writes the trimmed text once typing pauses', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useSearchDraft('', commit));
    act(() => result.current[1]('crm '));
    expect(result.current[0]).toBe('crm ');
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(commit).toHaveBeenCalledExactlyOnceWith('crm');
    // The address gave "crm" back: the input still shows the space the person typed
    expect(result.current[0]).toBe('crm ');
  });

  it('writes only the last text of a burst of keys', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useSearchDraft('', commit));
    act(() => result.current[1]('c'));
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS - 1));
    act(() => result.current[1]('cr'));
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(commit).toHaveBeenCalledExactlyOnceWith('cr');
  });

  it('writes nothing when the text is the address already has', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useSearchDraft('crm', commit));
    act(() => result.current[1]('crm '));
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(commit).not.toHaveBeenCalled();
  });

  it('follows an address that changes by itself (Back, an old link), and drops what was waiting', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ settled }) => useSearchDraft(settled, commit), {
      initialProps: { settled: 'crm' },
    });
    act(() => result.current[1]('crm tools'));
    rerender({ settled: 'seo' });
    expect(result.current[0]).toBe('seo');
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not overwrite the input with the address a write came back as', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ settled }) => useSearchDraft(settled, commit), {
      initialProps: { settled: '' },
    });
    act(() => result.current[1]('crm'));
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    // The person types on while the address catches up
    act(() => result.current[1]('crm t'));
    rerender({ settled: 'crm' });
    expect(result.current[0]).toBe('crm t');
  });

  it('writes nothing after it unmounts', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useSearchDraft('', commit));
    act(() => result.current[1]('crm'));
    unmount();
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(commit).not.toHaveBeenCalled();
  });
});
