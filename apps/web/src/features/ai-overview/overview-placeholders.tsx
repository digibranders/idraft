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

/** Inline metric chips skeleton for the page toolbar. */
export function StripPlaceholder(): ReactElement {
  return (
    <div aria-hidden="true" data-slot="strip-placeholder" className="flex items-center gap-4">
      {[0, 1, 2, 3].map((cell) => (
        <div key={cell} className={cell < 2 ? 'flex items-center gap-1.5' : 'hidden items-center gap-1.5 md:flex'}>
          <Skeleton shape="text-12" widthPct={48} />
          <Skeleton shape="text-14" widthPct={64} />
        </div>
      ))}
    </div>
  );
}

/** The row of the scope controls, one control high. */
export function ScopeBarPlaceholder(): ReactElement {
  return (
    <div aria-hidden="true" data-slot="scope-bar-placeholder" className="flex h-control-sm items-center gap-2">
      <span className="h-control-sm w-36 animate-skeleton-pulse rounded-md border border-border bg-surface" />
      <span className="h-control-sm w-28 animate-skeleton-pulse rounded-md border border-border bg-surface" />
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
