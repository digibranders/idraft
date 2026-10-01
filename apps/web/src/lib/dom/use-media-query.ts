'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, following changes. The server and hydration answer `false`, so a
 * component that depends on it renders its narrow form first; layout that must be right on the first
 * paint belongs in CSS (breakpoint variants), not here.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void): (() => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  const snapshot = useCallback((): boolean => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** The breakpoints of globals.css, as media queries. */
export const MEDIA = {
  /** 1024 px: the sidebar is on the page (rail or expanded), not a drawer. */
  lg: '(width >= 64rem)',
  /** 1024 to 1279 px: the rail, which expands over the content. */
  rail: '(width >= 64rem) and (width < 80rem)',
  /** 1280 px: the expanded sidebar, which the person may collapse. */
  xl: '(width >= 80rem)',
  /** 1440 px: the theme switch is in the top bar. */
  '2xl': '(width >= 90rem)',
  /** 1680 px: the widest column tier of a table (19-responsive-behavior.md section 6.1). */
  '3xl': '(width >= 105rem)',
} as const;
