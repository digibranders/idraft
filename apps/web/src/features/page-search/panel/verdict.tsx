'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { healthTone, verdictMessage } from '../health';
import type { PageHealth, PageNumbers, SearchWindow, Verdict as VerdictCode } from '../types';
import { Badge } from '@/components/ui/badge';
import { formatDateRange, formatDecimal, formatInteger, formatPercent } from '@/lib/format';

/** The keys under `pageSearch.health` (catalog keys are camelCase). */
export const HEALTH_KEYS = {
  lost: 'lost',
  sharp_drop: 'sharpDrop',
  declining: 'declining',
  stable: 'stable',
  growing: 'growing',
  new: 'new',
  low_data: 'lowData',
  no_data: 'noData',
} as const satisfies Record<VerdictCode, string>;

export interface VerdictProps {
  health: PageHealth;
  current: PageNumbers;
  /** `null` when the period is not compared, or the page has no stored day in the compared period. */
  previous: PageNumbers | null;
  window: SearchWindow;
  compareWindow: SearchWindow | null;
}

const rangeText = (window: SearchWindow): string => formatDateRange(window.from, window.to);

/** Places the average position moved between two periods, `null` when either has none. */
function placesMoved(current: PageNumbers, previous: PageNumbers | null): number | null {
  if (current.position === null || previous === null || previous.position === null) return null;
  return Math.abs(current.position - previous.position);
}

/** The health badge, one sentence for the verdict and one for each flag, all built from the API's codes and numbers (W6). */
export function Verdict({ health, current, previous, window, compareWindow }: VerdictProps): ReactElement {
  const t = useTranslations('pageSearch');
  const compared = previous !== null;
  const message = verdictMessage(health, compared);
  // A sentence without a comparison names the period itself; the others name the period compared with
  const period = rangeText(compared && compareWindow !== null ? compareWindow : window);
  const both = health.verdict === 'low_data';
  const basis = health.basis;
  const sentence = t(`verdict.${message}`, {
    metric: t(`metrics.${basis}`),
    change: formatPercent(Math.abs(health.change ?? 0), { decimals: 0 }),
    before: formatInteger(previous?.[basis]),
    now: formatInteger(current[basis]),
    period,
    clicks: formatInteger(current.clicks + (both ? (previous?.clicks ?? 0) : 0)),
    impressions: formatInteger(current.impressions + (both ? (previous?.impressions ?? 0) : 0)),
  });
  const places = placesMoved(current, previous);
  const placesText = places === null ? null : formatDecimal(places, 1);
  const sentences: string[] = [sentence];
  for (const flag of health.flags) {
    if (flag === 'ctr_fell_impressions_rose') sentences.push(t('verdict.ctrFellImpressionsRose'));
    else if (flag === 'position_slipped' && placesText !== null) {
      sentences.push(t('verdict.positionSlipped', { places: placesText }));
    } else if (flag === 'position_improved' && placesText !== null) {
      sentences.push(t('verdict.positionImproved', { places: placesText }));
    }
  }
  // The counts are per day when the two periods differ in length (the API scales the compared one)
  if (compared && compareWindow !== null && compareWindow.days !== window.days) sentences.push(t('verdict.perDay'));
  return (
    <div className="flex flex-col items-start gap-2">
      <Badge tone={healthTone(health.verdict)}>{t(`health.${HEALTH_KEYS[health.verdict]}`)}</Badge>
      <div className="flex flex-col gap-1">
        {sentences.map((text) => (
          <p key={text} className="type-body text-foreground">
            {text}
          </p>
        ))}
      </div>
    </div>
  );
}
