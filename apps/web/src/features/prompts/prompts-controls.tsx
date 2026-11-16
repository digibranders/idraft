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
 * Nothing here changes size with the data. On a phone the two selects share a line of their own and the filters and
 * the actions follow.
 */
export function PromptsControls({ platform, compare, filters, trailing }: PromptsControlsProps): ReactElement {
  return (
    <div data-slot="prompts-controls" className="flex w-full min-w-0 flex-wrap items-center gap-2 md:flex-nowrap">
      <div className="grid w-full min-w-0 grid-cols-2 gap-2 md:flex md:w-auto md:shrink-0 md:items-center">
        <div className="min-w-0 md:w-44 md:shrink-0">{platform}</div>
        {compare}
      </div>
      {/* The filters (a `nowrap` FilterBar) take the room that is left on one line and scroll inside themselves, so a narrow row never overlaps the status */}
      <div className="min-w-0 flex-1">{filters}</div>
      <div className="ml-auto flex shrink-0 items-center gap-3">{trailing}</div>
    </div>
  );
}
