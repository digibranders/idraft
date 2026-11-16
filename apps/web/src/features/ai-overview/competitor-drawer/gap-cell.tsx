'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { GapIcon, isLevel } from './gap-icon';
import { formatDecimal, formatPercent } from '@/lib/format';

/** The Gap column of a table of the drawer: your value against theirs as the icon, or "n/a" when either has no rate. */
export function GapCell({
  own,
  rival,
  name,
  decimals = 0,
}: {
  own: number | null;
  rival: number | null;
  name: string;
  /** The decimals of the two values the sentence quotes. */
  decimals?: 0 | 1;
}): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  if (own === null || rival === null) {
    return <span className="text-foreground-tertiary">{t('na')}</span>;
  }
  const difference = own - rival;
  const values = {
    name,
    own: formatPercent(own, { decimals }),
    rival: formatPercent(rival, { decimals }),
    points: formatDecimal(Math.abs(difference) * 100, 1),
  };
  const sentence = isLevel(difference)
    ? t('summary.gapLevel', values)
    : t(difference > 0 ? 'summary.gapAbove' : 'summary.gapBelow', values);
  return (
    <span className="inline-flex justify-end">
      <GapIcon difference={difference} sentence={sentence} />
    </span>
  );
}
