'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { cn } from '@/lib/utils';

/** A refetch that is over sooner than this never shows the bar, so a cache hit does not flash (17 section 3.4). */
const SHOW_AFTER_MS = 150;

export interface RefetchBarProps {
  /** A refetch is under way and the region keeps its previous data. */
  active: boolean;
  /**
   * Where the bar sits against its parent, which must be `relative` and which the bar overlays without taking room:
   * the page's blocks keep their places when it appears. `under-filter-bar` is centred in the 16 px gap below.
   */
  position: 'under-filter-bar' | 'under-table-header' | 'under-section-heading';
}

const POSITION_CLASS: Readonly<Record<RefetchBarProps['position'], string>> = {
  'under-filter-bar': cn('top-full mt-2'),
  'under-table-header': cn('top-full'),
  'under-section-heading': cn('top-full'),
};

/**
 * The static 2 px bar of a refetch with previous data on screen (17-empty-loading-error-states.md section 3.4,
 * 25 section 11.6): a full-width band in `primary` that appears after 150 ms and goes when the refetch is done. It
 * never travels, and it is hidden from assistive technology; the region it marks carries `aria-busy`.
 */
export function RefetchBar({ active, position }: RefetchBarProps): ReactElement | null {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [active]);
  if (!active || !shown) return null;
  return (
    <div
      aria-hidden="true"
      data-slot="refetch-bar"
      className={cn('pointer-events-none absolute inset-x-0 h-0.5 bg-primary', POSITION_CLASS[position])}
    />
  );
}
