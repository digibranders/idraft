'use client';

import { useEffect, useRef } from 'react';

import { announce } from '@/lib/a11y/announcer';

/** The wait after the last change of a filter or a search before the count of results is spoken. */
const RESULTS_ANNOUNCE_MS = 500;

/**
 * Says how many results show, once, 500 ms after the last change, and not when the text did not change
 * (20-accessibility.md section 10.2). `null` is "results not here yet" (loading, a failed read): nothing is said and
 * a pending timer is cancelled. The first text after that is the baseline: nothing is said on load. The timer is the
 * effect's own, so a change that ends where it began cancels the one before it.
 */
export function useResultAnnouncement(text: string | null, key: string): void {
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    if (text === null) return undefined;
    if (lastSpoken.current === null) {
      lastSpoken.current = text;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      if (text === lastSpoken.current) return;
      lastSpoken.current = text;
      announce(text, { key });
    }, RESULTS_ANNOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, key]);
}
