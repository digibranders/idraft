import type { ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

const TILES = ['mention', 'sov', 'citation', 'position', 'recommendation', 'sentiment', 'prompts', 'traffic'] as const;

/** The stand-in of the headline while it loads: the hero and the eight tiles at their final places, so nothing moves. */
export function HeadlineSkeleton(): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-4 xl:col-span-4">
        <Skeleton shape="text-14" widthPct={48} />
        <Skeleton shape="text-14" widthPct={56} className="h-8" />
        <Skeleton shape="text-13" widthPct={100} />
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4 xl:col-span-8">
        {TILES.map((tile) => (
          <div key={tile} className="flex min-w-0 flex-col justify-between gap-1 bg-surface px-4 py-3">
            <Skeleton shape="text-12" widthPct={72} />
            <Skeleton shape="text-14" widthPct={48} className="h-8" />
            <Skeleton shape="text-12" widthPct={56} />
          </div>
        ))}
      </div>
    </div>
  );
}
