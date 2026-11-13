'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { PendingSkeleton } from './cards/pending-skeleton';
import { SPAN_CLASS } from '@/features/layouts';
import { Skeleton } from '@/components/ui/skeleton';
import { SCREENS } from '@/lib/layouts';

/**
 * What stands where the page's parts are not built yet or have not loaded, each at its final height so nothing
 * moves when the part arrives (DS 17): the number strip (T8), the scope bar (T7) and, while the engines load, the
 * grid of the built-in layout. They are skeletons: they pulse and are hidden from assistive technology.
 */

/** The panel of the metric strip, 76 px, with the cells of the built-in layout's numbers (two on a phone). */
export function StripPlaceholder(): ReactElement {
  return (
    <div
      aria-hidden="true"
      className="flex h-metric-strip divide-x divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface"
    >
      {[0, 1, 2, 3].map((cell) => (
        <div
          key={cell}
          className={
            cell < 2
              ? 'flex min-w-0 flex-1 flex-col justify-center gap-1 px-4'
              : 'hidden min-w-0 flex-1 flex-col justify-center gap-1 px-4 md:flex'
          }
        >
          <Skeleton shape="text-12" widthPct={56} />
          <Skeleton shape="text-14" widthPct={72} />
        </div>
      ))}
    </div>
  );
}

/** The row of the scope controls, one control high. */
export function ScopeBarPlaceholder(): ReactElement {
  return (
    <div aria-hidden="true" className="flex h-control items-center gap-2">
      <span className="h-control w-44 animate-skeleton-pulse rounded-md bg-surface-subtle" />
      <span className="h-control w-32 animate-skeleton-pulse rounded-md bg-surface-subtle" />
    </div>
  );
}

/** The cards of the built-in layout as skeletons in their widths: the grid the page shows once the engines are read. */
export function GridPlaceholder(): ReactElement {
  const t = useTranslations('aiOverview');
  return (
    <div role="status" aria-label={t('loading')} className="grid grid-cols-12 gap-4">
      {(SCREENS.ai_overview.builtin.cards ?? []).map(({ id, width }) => (
        <div key={id} className={width === undefined ? SPAN_CLASS.full : SPAN_CLASS[width]}>
          <PendingSkeleton />
        </div>
      ))}
    </div>
  );
}
