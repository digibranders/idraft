import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { millisToNextUtcDay, useUtcDay } from './use-utc-day';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-30T12:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('millisToNextUtcDay', () => {
  it('counts to the next midnight in UTC', () => {
    expect(millisToNextUtcDay(new Date('2026-09-30T23:59:00Z'))).toBe(60_000);
    expect(millisToNextUtcDay(new Date('2026-09-30T00:00:00Z'))).toBe(86_400_000);
    expect(millisToNextUtcDay(new Date('2026-12-31T18:00:00Z'))).toBe(6 * 3_600_000);
  });
});

describe('useUtcDay', () => {
  it('keeps the same date while the UTC day lasts, whatever the clock does inside it', () => {
    const { result } = renderHook(() => useUtcDay());
    const first = result.current;
    expect(first.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    act(() => {
      vi.advanceTimersByTime(3 * 3_600_000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe(first);
  });

  it('moves to the new day at UTC midnight, with no one looking', () => {
    const { result } = renderHook(() => useUtcDay());
    act(() => {
      vi.advanceTimersByTime(12 * 3_600_000 + 1_000);
    });
    expect(result.current.toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('reads the clock again when the window is focused after a sleep that outlasted the timer', () => {
    const { result } = renderHook(() => useUtcDay());
    act(() => {
      // The machine slept: the clock moved on without the timer firing
      vi.setSystemTime(new Date('2026-10-02T08:00:00Z'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current.toISOString()).toBe('2026-10-02T08:00:00.000Z');
  });

  it('cleans up its timer and its listener when it unmounts', () => {
    const removed = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useUtcDay());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('focus', expect.any(Function));
  });
});
