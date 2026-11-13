'use client';

import { useEffect, useState } from 'react';

import { formatIsoDate } from '@/lib/format';

/** A zone's midnight is not UTC midnight, and zones differ, so the day is read on a short interval instead. */
const POLL_MS = 60_000;

/**
 * The business day (`YYYY-MM-DD`) it is now in the IANA zone `timeZone`. It is read again every 60 seconds and
 * when the window is focused or shown again (a machine that slept), and state is set only when the day changed,
 * so nothing renders in between. `useUtcDay` turns at UTC midnight only, which is the wrong moment for a
 * project whose day starts at another hour (Asia/Kolkata starts its day at 18:30 UTC).
 */
export function useZoneDay(timeZone: string): string {
  const [day, setDay] = useState(() => formatIsoDate(new Date(), timeZone));
  useEffect(() => {
    const read = (): void => setDay(formatIsoDate(new Date(), timeZone));
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') read();
    };
    // A new zone is a new day to read at once
    read();
    const timer = setInterval(read, POLL_MS);
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [timeZone]);
  return day;
}
