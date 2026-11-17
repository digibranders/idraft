import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const FILL: Readonly<Record<number, string>> = {
  1: cn('bg-chart-1'),
  2: cn('bg-chart-2'),
  3: cn('bg-chart-3'),
  4: cn('bg-chart-4'),
  5: cn('bg-chart-5'),
  6: cn('bg-chart-6'),
};

/**
 * The color an entity has in this project's charts and highlights: chart 1 for the own brand, its
 * `color_index` for the others, a dashed `chart-other` square past the sixth. Decoration: the name beside
 * it carries the meaning.
 */
export function EntitySwatch({
  colorIndex,
  own,
  shape = 'square',
}: {
  colorIndex: number | null;
  own: boolean;
  /** `dot`: the round mark of the Citations page (C 128 to 133); a third party there is a solid `chart-other` dot. */
  shape?: 'square' | 'dot' | undefined;
}): ReactNode {
  const fill = own ? FILL[1] : colorIndex === null ? undefined : FILL[colorIndex];
  const dot = shape === 'dot';
  return (
    <span
      aria-hidden="true"
      data-color-index={own ? 1 : (colorIndex ?? undefined)}
      className={cn(
        'size-2 shrink-0',
        dot ? 'rounded-full' : 'rounded-xs',
        fill ?? (dot ? 'bg-chart-other' : 'border border-dashed border-chart-other'),
      )}
    />
  );
}
