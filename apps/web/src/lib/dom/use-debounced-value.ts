'use client';

import { useEffect, useState } from 'react';

/**
 * `value` once it has stayed the same for `delay` milliseconds: feedback that follows typing without
 * changing on every key, such as a preview or a search request.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
