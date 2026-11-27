'use client';

import {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

/** A preview that keeps the inspector inside its own box gives the box's width here; `null` on a page. */
export const InspectorBoxContext = createContext<{ width: number | null } | null>(null);

/**
 * Where an inspector that lays over the list begins, in pixels from the window's left edge; `null` while
 * none does. What the card covers is no place for a control of the list, so a bar of actions keeps clear of it.
 */
export const InspectorOverlayContext = createContext<number | null>(null);

/** Set by an `Inspector` that lays over the list, and cleared when it becomes a sheet or closes. */
export const InspectorOverlaySetterContext = createContext<(left: number | null) => void>(() => undefined);

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
  /**
   * A preview with a fixed height: the inspector stays inside this box and takes its limit from the box's width.
   * Default `false`.
   */
  boxed?: boolean;
}

/**
 * A list page with room for the inspector (16-drawers-dialogs-popovers.md section 2.6): the main column, and the
 * open inspector, which lays over the page and takes no room in it. Only a `boxed` preview measures its own width,
 * so the inspector can take 60% of the box instead of 60% of the window.
 */
export function InspectorLayout({ children, inspector, boxed = false }: InspectorLayoutProps): ReactElement {
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [overlayLeft, setOverlayLeft] = useState<number | null>(null);
  useEffect(() => {
    const element = area.current;
    if (!boxed || element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [boxed]);
  const box = useMemo(() => (boxed ? { width } : null), [boxed, width]);
  return (
    <InspectorBoxContext value={box}>
      <InspectorOverlayContext value={overlayLeft}>
        <InspectorOverlaySetterContext value={setOverlayLeft}>
          <div ref={area} className={cn('flex min-w-0 flex-1 items-start', boxed && 'relative isolate')}>
            <div className="flex min-w-0 flex-1 flex-col self-stretch">{children}</div>
            {inspector}
          </div>
        </InspectorOverlaySetterContext>
      </InspectorOverlayContext>
    </InspectorBoxContext>
  );
}
