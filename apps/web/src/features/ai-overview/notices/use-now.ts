'use client';

import { useEffect, useState } from 'react';

/** Often enough for an age counted in days, which is all the notices say. */
const TICK_MS = 60_000;

/** The time now, read again every minute, so an answer that turns stale while the page is open is seen. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
