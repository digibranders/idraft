'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { preferenceKey } from './storage';

/**
 * A person's preferences (11-navigation.md section 5, Settings > Preferences), kept in this browser under
 * their user id. The theme is not here: next-themes keeps it for the device.
 */
export interface Preferences {
  /**
   * The row height the person chose for tables: 32 px (compact, the default since the owner decision of
   * 2026-10-29) or 40 px (comfortable). Only an explicit choice of 40 px is stored (under `tableDensity`), so a
   * record that merely holds other settings, or an older `density` key, means compact. The data tables do not
   * read it yet: each opens compact and keeps its own choice in its link.
   */
  density: 'default' | 'compact';
  /**
   * How numbers and dates are written. Kept now, and shown in the example on the Preferences page;
   * `lib/format` takes it once the analytics screens format with it, and nothing else reads it yet.
   */
  locale: PreferenceLocale;
  /** Transitions and the theme reveal off, whatever the system says. */
  reduceMotion: boolean;
  /** Keys such as `[` and `?` act as shortcuts (WCAG 2.1.4). */
  singleKeys: boolean;
}

export const PREFERENCE_LOCALES = ['en-US', 'en-GB', 'de-DE'] as const;
export type PreferenceLocale = (typeof PREFERENCE_LOCALES)[number];

export const DEFAULT_PREFERENCES: Preferences = {
  density: 'compact',
  locale: 'en-US',
  reduceMotion: false,
  singleKeys: true,
};

const NAME = 'settings';

/** What is stored, read without trusting it: another version of the app, or a hand edit, may have written it. */
function parse(raw: string | null): Preferences {
  if (raw === null) return DEFAULT_PREFERENCES;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES;
    const record = value as Record<string, unknown>;
    return {
      // The older `density` key is ignored: it was written with every other setting, chosen or not
      density: record.tableDensity === 'default' ? 'default' : DEFAULT_PREFERENCES.density,
      locale: PREFERENCE_LOCALES.find((locale) => locale === record.locale) ?? DEFAULT_PREFERENCES.locale,
      reduceMotion: record.reduceMotion === true,
      singleKeys: record.singleKeys !== false,
    };
  } catch (error) {
    if (error instanceof SyntaxError) return DEFAULT_PREFERENCES;
    throw error;
  }
}

/** Readers in this tab, told when a preference changes here; other tabs hear the `storage` event. */
const listeners = new Set<() => void>();

/**
 * What a browser that refuses storage (a private window, a full or blocked store) keeps instead, per user,
 * so a change still lasts for the life of this page.
 */
const unsaved = new Map<string, string>();

function read(userId: string): string | null {
  try {
    return localStorage.getItem(preferenceKey(userId, NAME)) ?? unsaved.get(userId) ?? null;
  } catch (error) {
    if (error instanceof DOMException) return unsaved.get(userId) ?? null;
    throw error;
  }
}

function write(userId: string, preferences: Preferences): void {
  const { density, ...others } = preferences;
  const text = JSON.stringify(density === 'default' ? { ...others, tableDensity: density } : others);
  try {
    localStorage.setItem(preferenceKey(userId, NAME), text);
    unsaved.delete(userId);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    unsaved.set(userId, text);
  }
  for (const listener of listeners) listener();
}

const cache = new Map<string, { raw: string | null; value: Preferences }>();

/** The same object while the stored text is the same, as `useSyncExternalStore` needs. */
function snapshotOf(userId: string): Preferences {
  const raw = read(userId);
  const cached = cache.get(userId);
  if (cached && cached.raw === raw) return cached.value;
  const value = parse(raw);
  cache.set(userId, { raw, value });
  return value;
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  window.addEventListener('storage', notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', notify);
  };
}

/**
 * The person's preferences and a setter that saves one at once (10-forms.md section 13.3: no save bar).
 * The server and hydration see the defaults; the stored values follow right after.
 */
export function usePreferences(
  userId: string,
): [Preferences, <K extends keyof Preferences>(name: K, value: Preferences[K]) => void] {
  const preferences = useSyncExternalStore(
    subscribe,
    () => snapshotOf(userId),
    () => DEFAULT_PREFERENCES,
  );
  const set = useCallback(
    <K extends keyof Preferences>(name: K, value: Preferences[K]): void => {
      write(userId, { ...snapshotOf(userId), [name]: value });
    },
    [userId],
  );
  return [preferences, set];
}
