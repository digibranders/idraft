import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCES, usePreferences } from './preferences';
import { clearPreferences, preferenceKey } from './storage';

const ANA = 'user-ana';
const BEN = 'user-ben';
const keyOf = (userId: string): string => preferenceKey(userId, 'settings');

describe('usePreferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearPreferences();
  });

  it('starts from the defaults, and keeps each person apart', () => {
    const ana = renderHook(() => usePreferences(ANA));
    expect(ana.result.current[0]).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.density).toBe('compact');
    act(() => ana.result.current[1]('density', 'default'));
    expect(ana.result.current[0].density).toBe('default');
    expect(renderHook(() => usePreferences(BEN)).result.current[0]).toEqual(DEFAULT_PREFERENCES);
    expect(JSON.parse(localStorage.getItem(keyOf(ANA)) ?? '{}')).toMatchObject({ tableDensity: 'default' });
  });

  describe('table density counts only as an explicit choice', () => {
    const densityOf = (stored: unknown): string => {
      localStorage.setItem(keyOf(ANA), JSON.stringify(stored));
      return renderHook(() => usePreferences(ANA)).result.current[0].density;
    };

    it('reads a legacy density of "default" stored with the other settings as not chosen: compact', () => {
      expect(densityOf({ density: 'default', locale: 'de-DE', reduceMotion: true, singleKeys: false })).toBe('compact');
    });

    it('reads a record without a density, and one with the legacy "compact", as compact', () => {
      expect(densityOf({ locale: 'en-GB' })).toBe('compact');
      expect(densityOf({ density: 'compact', locale: 'en-GB' })).toBe('compact');
    });

    it('keeps Default (40 px) once the person chooses it, through other changes, and drops it on choosing Compact', () => {
      const { result } = renderHook(() => usePreferences(ANA));
      act(() => result.current[1]('density', 'default'));
      act(() => result.current[1]('reduceMotion', true));
      expect(result.current[0].density).toBe('default');
      expect(JSON.parse(localStorage.getItem(keyOf(ANA)) ?? '{}')).toMatchObject({ tableDensity: 'default' });
      act(() => result.current[1]('density', 'compact'));
      expect(result.current[0].density).toBe('compact');
      expect(JSON.parse(localStorage.getItem(keyOf(ANA)) ?? '{}')).not.toHaveProperty('tableDensity');
    });

    it('does not store a density when only another setting is changed', () => {
      const { result } = renderHook(() => usePreferences(ANA));
      act(() => result.current[1]('singleKeys', false));
      const stored: Record<string, unknown> = JSON.parse(localStorage.getItem(keyOf(ANA)) ?? '{}');
      expect(stored).not.toHaveProperty('density');
      expect(stored).not.toHaveProperty('tableDensity');
    });
  });

  it('reads what is stored without trusting it', () => {
    localStorage.setItem(keyOf(ANA), '{not json');
    expect(renderHook(() => usePreferences(ANA)).result.current[0]).toEqual(DEFAULT_PREFERENCES);
    localStorage.setItem(
      keyOf(BEN),
      JSON.stringify({ density: 'huge', locale: 'fr-FR', reduceMotion: 'yes', singleKeys: false }),
    );
    expect(renderHook(() => usePreferences(BEN)).result.current[0]).toEqual({
      ...DEFAULT_PREFERENCES,
      singleKeys: false,
    });
  });

  it('follows a change made in another tab', () => {
    const { result } = renderHook(() => usePreferences(ANA));
    act(() => {
      localStorage.setItem(keyOf(ANA), JSON.stringify({ reduceMotion: true }));
      window.dispatchEvent(new StorageEvent('storage', { key: keyOf(ANA) }));
    });
    expect(result.current[0].reduceMotion).toBe(true);
  });

  it('keeps a change for this page when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const { result } = renderHook(() => usePreferences(ANA));
    act(() => result.current[1]('singleKeys', false));
    expect(result.current[0].singleKeys).toBe(false);
    expect(localStorage.getItem(keyOf(ANA))).toBeNull();
  });
});
