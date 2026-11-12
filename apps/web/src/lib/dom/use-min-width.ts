'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Whether the element is at least `minWidth` px wide, following its size. Only the answer is state, so a resize
 * that does not cross the minimum renders nothing. `false` until the element is measured (the server, hydration,
 * and a browser without `ResizeObserver`): a component that depends on it renders its narrow form first.
 */
export function useMinWidth<T extends HTMLElement>(minWidth: number): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWide(entry.contentRect.width >= minWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [minWidth]);
  return [ref, wide];
}
