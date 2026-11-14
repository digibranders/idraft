import type { ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * What the two cards of the collection days hold in their frame while the days load, so that nothing moves when the
 * days arrive (WP-37 T7c). The loaded frame has a row of engine tabs and the views group (Patterns, Table, the menu),
 * which wrap onto a second row when the card is narrow; the placeholders are as many and as wide as those, in the same
 * wrapping row, so they wrap where the real ones do. The loaded card also takes more room when it is narrow (the meta
 * line wraps, and the calendar's key takes another line): `NarrowReserve` holds that room by the width of the card
 * and not by the width of the page, because the cards sit in columns of different widths.
 */

export interface LoadingControlsProps {
  /** How many engine tabs the loaded card will have, as far as the page knows before the days are read. */
  engines: number;
  /** The bar card has the Patterns toggle in its views group; the calendar does not. */
  patterns: boolean;
}

/** The tabs and the views group, as the frame's controls: siblings in its wrapping row, the views at the end. */
export function LoadingControls({ engines, patterns }: LoadingControlsProps): ReactElement {
  return (
    <>
      <div data-slot="controls-placeholder" className="flex flex-wrap gap-2">
        {Array.from({ length: Math.max(1, engines) }, (_, place) => (
          // The tabs are placeholders in a fixed order, so the position is their identity
          // About as wide as an engine name and its count
          <div key={place} className="h-control-sm w-32">
            <Skeleton shape="block" className="h-full w-full" />
          </div>
        ))}
      </div>
      <div data-slot="views-placeholder" className="ml-auto flex items-center gap-1">
        {patterns ? (
          <div className="h-control-sm w-18">
            <Skeleton shape="block" className="h-full w-full" />
          </div>
        ) : null}
        <div className="h-control-sm w-13">
          <Skeleton shape="block" className="h-full w-full" />
        </div>
        <div className="h-control-sm w-8">
          <Skeleton shape="block" className="h-full w-full" />
        </div>
      </div>
    </>
  );
}

/**
 * Room that exists only while the card is narrow (under 28 rem of its own width, where its meta line wraps to a second
 * line, and for the calendar where its key wraps to another): put at the end of the footnote, which spans the frame.
 */
export function NarrowReserve({ calendarKey }: { calendarKey: boolean }): ReactElement {
  return (
    <div data-slot="narrow-reserve" aria-hidden="true" className="@container">
      <div className="h-0 @max-md:h-5" />
      {calendarKey ? <div className="h-0 @max-md:h-6" /> : null}
    </div>
  );
}
