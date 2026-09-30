import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearPreferences, preferenceKey } from './storage';

const THEME_KEY = 'sightline.theme';

describe('preference storage', () => {
  afterEach(() => localStorage.removeItem(THEME_KEY));

  it('keys a preference by user', () => {
    expect(preferenceKey('user-1', 'density')).toBe('sightline.pref.user-1.density');
  });

  it('removes every preference of every user and leaves other keys', () => {
    localStorage.setItem(preferenceKey('user-1', 'density'), 'compact');
    localStorage.setItem(preferenceKey('user-2', 'shortcuts'), 'off');
    localStorage.setItem(THEME_KEY, 'dark');
    clearPreferences();
    expect(Object.keys(localStorage).filter((key) => key.startsWith('sightline.'))).toEqual([THEME_KEY]);
  });

  it('does nothing where storage is refused', () => {
    const refusing = {
      get length(): number {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Storage;
    expect(() => clearPreferences(refusing)).not.toThrow();
  });

  it('does nothing where even reading localStorage is refused', () => {
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => clearPreferences()).not.toThrow();
    blocked.mockRestore();
  });
});
