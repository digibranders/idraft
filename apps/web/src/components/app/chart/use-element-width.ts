import { useEffect, useRef, useState, type RefObject } from 'react';

/** Widths are rounded to this many px, so a chart that draws px sizes redraws per step of a resize and not per pixel. */
const STEP = 16;

/**
 * The width of an element in px, rounded to a step, and 0 until it has been measured (the first render, the server, a test).
 * For charts whose option holds sizes in px, such as the radius of a ring or the width of an axis label.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const element = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = element.current;
    if (node === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width / STEP) * STEP);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [element, width];
}
