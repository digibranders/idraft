'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * A rate over fewer than `MIN_OBSERVATIONS` valid answers, in place of a percent (parity spec decision D-1): the
 * answers there are, on the hatched muted ground of InsufficientData (docs/design-system/12 section 7.3), with
 * what is missing in a tooltip. The tables' cells show an insufficient rate this way. The strip does not use it:
 * `MetricStrip` draws the same hatched ground for an item that is `insufficient`. A table cell carries the
 * tooltip itself, where the keyboard reaches it: it passes `tip={false}` and gives the same text as the cell's.
 */
export function InsufficientPill({ answers, tip = true }: { answers: number; tip?: boolean }): ReactElement {
  const t = useTranslations('common.insufficient');
  const pill = (
    <span className="inline-flex h-6 items-center rounded-xs bg-insufficient px-1.5 type-label whitespace-nowrap text-foreground-tertiary">
      {t('answers', { count: answers })}
    </span>
  );
  return tip ? <Tooltip content={t('tip', { count: answers, min: MIN_OBSERVATIONS })}>{pill}</Tooltip> : pill;
}
