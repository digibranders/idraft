'use client';

import { useEffect, useState } from 'react';

const DAY_MS = 86_400_000;
/** A timer never fires sooner than this after the last one, so a clock a hair behind midnight cannot spin. */
const MIN_WAIT_MS = 1_000;

const dayOf = (date: Date): number => Math.floor(date.getTime() / DAY_MS);

/** Milliseconds from `from` to the next midnight in UTC. */
export const millisToNextUtcDay = (from: Date): number => (dayOf(from) + 1) * DAY_MS - from.getTime();

/**
 * The moment this page is in, as a `Date` that is the same object for the whole UTC day: queries keyed by it
 * keep their keys and caches within the day. It is read again when the UTC day turns (a timer set for the next
 * midnight) and when the window is focused or shown again, which catches a machine that slept through the
 * timer. Pages whose month and "today" come from the provider's UTC days use it, so a tab left open
 * overnight asks for the new day instead of the one it was opened on.
 */
export function useUtcDay(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (): void => {
      const fresh = new Date();
      setNow((current) => (dayOf(current) === dayOf(fresh) ? current : fresh));
      clearTimeout(timer);
      timer = setTimeout(read, Math.max(MIN_WAIT_MS, millisToNextUtcDay(fresh)));
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') read();
    };
    timer = setTimeout(read, Math.max(MIN_WAIT_MS, millisToNextUtcDay(new Date())));
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}
