'use client';

import { useCallback, useState, type RefCallback } from 'react';

/** One viewport of room above and below: a card's code loads before it is scrolled to. */
export const NEAR_MARGIN = '100% 0px';

/**
 * Whether an element has come within one viewport of the screen, for good: once near it stays near, so a card
 * that has loaded never unloads. Where there is no IntersectionObserver the element counts as near.
 */
export function useNearViewport(): { ref: RefCallback<HTMLElement>; near: boolean } {
  const [near, setNear] = useState(false);
  const ref = useCallback<RefCallback<HTMLElement>>(
    (node) => {
      if (node === null || near) return undefined;
      if (!('IntersectionObserver' in window)) {
        setNear(true);
        return undefined;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          setNear(true);
          observer.disconnect();
        },
        { rootMargin: NEAR_MARGIN },
      );
      observer.observe(node);
      return () => {
        observer.disconnect();
      };
    },
    [near],
  );
  return { ref, near };
}
