'use client';

import type { ReactElement, ReactNode } from 'react';

export interface PromptsControlsProps {
  /** The Platform select. */
  platform: ReactNode;
  /** The Compare select. */
  compare: ReactNode;
  /** The filter bar, in the room the selects and the trailing controls leave. */
  filters: ReactNode;
  /** The status of the collection, the update time, More actions and Add prompts: the right edge. */
  trailing: ReactNode;
}

/**
 * The first row of the Prompts page, every control at one height (the preview's row 1): the Platform select and
 * Compare at fixed widths, the filters taking the room that is left, the status and the actions at the right edge.
 * Nothing here changes size with the data. The layout follows the width of the row itself, not the window's: under
 * 672 px the two selects share a line of their own and the filters and the actions follow; from 672 px the selects and
 * the filters share the first line and the actions have the next; from 792 px the selects and the actions share the
 * first line and the filters have the next; from 900 px it is one line. A drawer lays over the right end of the row
 * and the row does not change for it, as no page header does.
 */
export function PromptsControls({ platform, compare, filters, trailing }: PromptsControlsProps): ReactElement {
  return (
    <div className="@container min-w-0">
      <div
        data-slot="prompts-controls"
        className="flex w-full min-w-0 flex-wrap items-center gap-2 @[56.25rem]:flex-nowrap"
      >
        <div className="grid w-full min-w-0 grid-cols-2 gap-2 @2xl:flex @2xl:w-auto @2xl:shrink-0 @2xl:items-center">
          <div className="min-w-0 @2xl:w-44 @2xl:shrink-0">{platform}</div>
          {compare}
        </div>
        {/* From 900 px the filters (a `nowrap` FilterBar) take the room that is left on one line and scroll inside
            themselves. From 792 px the row is too narrow for them beside the status and the actions (the collection
            badge is 100 px more), so the filters take a line of their own under the selects and the actions. From
            672 px to 792 px the selects and the filters share the first line and the actions have the next */}
        <div className="min-w-0 flex-1 @2xl:order-2 @[49.5rem]:order-3 @[49.5rem]:w-full @[49.5rem]:flex-none @[56.25rem]:order-none @[56.25rem]:w-auto @[56.25rem]:flex-1">
          {filters}
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-3 @2xl:order-3 @2xl:w-full @[49.5rem]:order-2 @[49.5rem]:w-auto @[56.25rem]:order-none">
          {trailing}
        </div>
      </div>
    </div>
  );
}
