import type { ReactElement } from 'react';

import type { MapColour } from '@/lib/internal-links/map-graph';
import { cn } from '@/lib/utils';

/** The fill and the rim of a dot of the map, as the design tokens the canvas reads (a palette slot is `chart-n`). */
function paint(colour: MapColour): { background: string; rim: boolean } {
  switch (colour.kind) {
    case 'palette':
      return { background: `var(--chart-${String(colour.index + 1)})`, rim: false };
    case 'other':
      return { background: 'var(--chart-other)', rim: false };
    case 'named':
      return { background: `var(--${colour.name})`, rim: true };
    case 'hollow':
      return { background: 'var(--surface)', rim: true };
  }
}

/** A round 10 px mark of a colour group. Switched off, it is hollow. */
export function MapSwatch({ colour, off = false }: { colour: MapColour; off?: boolean }): ReactElement {
  const { background, rim } = paint(colour);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full border',
        rim || off ? 'border-border-strong' : 'border-transparent',
      )}
      style={{ background: off ? 'var(--surface)' : background }}
    />
  );
}
