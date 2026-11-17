'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { GapIcon } from './gap-icon';
import { formatDecimal, formatPercent } from '@/lib/format';
import { isDetectableDifference, type Counts } from '@/lib/stats';

/**
 * The Gap column of a table of the drawer: your value against theirs as the icon, or "n/a" when either has no rate.
 * The icon takes a colour only when the two rates differ detectably (the counts behind both are `ownCounts` and
 * `rivalCounts`); without counts, or within normal variation, it is a grey dash that says so.
 */
export function GapCell({
  own,
  rival,
  ownCounts,
  rivalCounts,
  name,
  decimals = 0,
}: {
  own: number | null;
  rival: number | null;
  /** The k of n behind each rate; `null` where the API gives no count, which leaves the gap untested. */
  ownCounts: Counts | null;
  rivalCounts: Counts | null;
  name: string;
  /** The decimals of the two values the sentence quotes. */
  decimals?: 0 | 1;
}): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  if (own === null || rival === null) {
    return <span className="text-foreground-tertiary">{t('na')}</span>;
  }
  const difference = own - rival;
  const detectable = isDetectableDifference(ownCounts, rivalCounts) === true;
  const values = {
    name,
    own: formatPercent(own, { decimals }),
    rival: formatPercent(rival, { decimals }),
    points: formatDecimal(Math.abs(difference) * 100, 1),
  };
  const sentence = t(
    !detectable || difference === 0 ? 'summary.gapLevel' : difference > 0 ? 'summary.gapAbove' : 'summary.gapBelow',
    values,
  );
  return (
    <span className="inline-flex justify-end">
      <GapIcon difference={difference} detectable={detectable} sentence={sentence} />
    </span>
  );
}
