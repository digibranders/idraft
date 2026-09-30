'use client';

import { useCallback, useState, type ReactNode } from 'react';

/**
 * A table that scrolls sideways when the page is narrower than it. While it overflows, the scroller is a
 * named tab stop, so a keyboard user can scroll it with the arrow keys (WCAG 2.1.1); while it fits, it is
 * no stop at all, like `ScrollArea`.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }): ReactNode {
  const [overflows, setOverflows] = useState(false);
  const observe = useCallback((node: HTMLDivElement | null): (() => void) | undefined => {
    if (!node) return undefined;
    const measure = (): void => setOverflows(node.scrollWidth > node.clientWidth);
    measure();
    // Environments without ResizeObserver (jsdom) keep the first measurement
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={observe}
      role="region"
      aria-label={label}
      tabIndex={overflows ? 0 : undefined}
      className="overflow-x-auto rounded-md focus-visible:focus-ring-inset"
    >
      {children}
    </div>
  );
}
