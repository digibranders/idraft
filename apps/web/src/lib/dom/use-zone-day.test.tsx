import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useZoneDay } from './use-zone-day';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-12T12:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useZoneDay', () => {
  it('is the business day of the zone, not of UTC', () => {
    vi.setSystemTime(new Date('2026-11-12T19:00:00Z'));
    expect(renderHook(() => useZoneDay('Asia/Kolkata')).result.current).toBe('2026-11-13');
    expect(renderHook(() => useZoneDay('America/New_York')).result.current).toBe('2026-11-12');
  });

  it('turns to the next day within a minute of the zone midnight, which is not UTC midnight', () => {
    // 18:29:30 UTC is 23:59:30 in Kolkata
    vi.setSystemTime(new Date('2026-11-12T18:29:30Z'));
    const { result } = renderHook(() => useZoneDay('Asia/Kolkata'));
    expect(result.current).toBe('2026-11-12');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-11-13');
  });

  it('reads the clock again when the window is focused or shown after a sleep', () => {
    const { result } = renderHook(() => useZoneDay('Europe/Amsterdam'));
    expect(result.current).toBe('2026-11-12');
    act(() => {
      vi.setSystemTime(new Date('2026-11-14T08:00:00Z'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe('2026-11-14');
    act(() => {
      vi.setSystemTime(new Date('2026-11-16T08:00:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-11-16');
  });

  it('does not render again while the day stays the same', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useZoneDay('Europe/Amsterdam');
    });
    const before = renders;
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe('2026-11-12');
    expect(renders).toBe(before);
  });

  it('follows a change of zone and cleans up its timer and listeners when it unmounts', () => {
    const removed = vi.spyOn(window, 'removeEventListener');
    const { result, rerender, unmount } = renderHook(({ zone }) => useZoneDay(zone), {
      initialProps: { zone: 'America/Los_Angeles' },
    });
    vi.setSystemTime(new Date('2026-11-12T23:00:00Z'));
    rerender({ zone: 'Pacific/Auckland' });
    expect(result.current).toBe('2026-11-13');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('focus', expect.any(Function));
  });
});
