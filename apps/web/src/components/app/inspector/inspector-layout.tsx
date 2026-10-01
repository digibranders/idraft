'use client';

import {
  createContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';

/** The width beside the sidebar, which the docking rule needs; `null` until it is measured. */
export const InspectorAreaContext = createContext<number | null>(null);

const subscribeResize = (listener: () => void): (() => void) => {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
};
/** Before the first paint on the client the inspector assumes a laptop, the common case. */
const SERVER_VIEWPORT = 1440;

/** The window's width, for the sheet and overlay limits of 16 section 2.6. */
export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerWidth,
    () => SERVER_VIEWPORT,
  );
}

export interface InspectorLayoutProps {
  /** The page's main column. */
  children: ReactNode;
  /** The open `Inspector`, or nothing. */
  inspector: ReactNode;
}

/**
 * A list page with room for the inspector (16-drawers-dialogs-popovers.md section 2.6): the main column,
 * and the docked inspector beside it, under the top bar. It measures its own width, which is the viewport
 * less the sidebar, so the inspector can decide whether it docks or lays over the list.
 */
export function InspectorLayout({ children, inspector }: InspectorLayoutProps): ReactElement {
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = area.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <InspectorAreaContext value={width}>
      <div ref={area} className="flex min-w-0 flex-1 items-start">
        <div className="flex min-w-0 flex-1 flex-col self-stretch">{children}</div>
        {inspector}
      </div>
    </InspectorAreaContext>
  );
}
