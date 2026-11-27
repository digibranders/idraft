'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { PageNumbers, SearchWindow } from '../types';
import { Delta } from '@/components/app/metric/delta';
import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { formatCompact, formatDecimal, formatMetricDelta, formatPercent, type ChangeTone } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A move that rounds to this is no move. */
const ZERO_PLACES = formatDecimal(0, 1);
const GROUP_ID = 'search';

const TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground-secondary'),
} as const satisfies Record<ChangeTone, string>;

/**
 * The relative change of a count between two periods. When they differ in length the change is per day, as the
 * API's health verdict is. `null` when there is nothing to compare with (no previous, or a previous of 0).
 */
export function relativeChange(
  current: number,
  previous: number | null,
  days: { current: number; before: number },
): number | null {
  if (previous === null || previous === 0) return null;
  return current / days.current / (previous / days.before) - 1;
}

export interface MetricTilesProps {
  current: PageNumbers;
  /** `null`: the period is not compared, or has no stored day to compare with. */
  previous: PageNumbers | null;
  window: SearchWindow;
  compareWindow: SearchWindow | null;
  status: 'ready' | 'refetching';
}

/** Clicks, Impressions, CTR and Average position of the period, each with the value before and the change. */
export function MetricTiles({ current, previous, window, compareWindow, status }: MetricTilesProps): ReactElement {
  const t = useTranslations('pageSearch');
  const days = { current: window.days, before: compareWindow?.days ?? window.days };
  const before = (text: string): string | undefined =>
    previous === null ? undefined : t('beforeValue', { value: text });
  const noImpressions = t('states.noImpressions');

  const count = (id: 'clicks' | 'impressions'): MetricStripItem => ({
    id,
    label: t(`metrics.${id}`),
    value: formatCompact(current[id]),
    context: before(formatCompact(previous?.[id])),
    delta: (
      <Delta
        size="sm"
        input={{
          value: relativeChange(current[id], previous?.[id] ?? null, days),
          unit: 'relative',
          polarity: 'higher_is_better',
          isDetectable: null,
        }}
      />
    ),
  });

  const ctrPoints = current.ctr === null || previous?.ctr == null ? null : current.ctr - previous.ctr;
  const ctr: MetricStripItem = {
    id: 'ctr',
    label: t('metrics.ctr'),
    value: formatPercent(current.ctr),
    ...(current.ctr === null ? { unknown: { kind: 'not-applicable' as const }, tip: noImpressions } : {}),
    context: before(formatPercent(previous?.ctr)),
    delta: (
      <Delta size="sm" input={{ value: ctrPoints, unit: 'points', polarity: 'higher_is_better', isDetectable: null }} />
    ),
  };

  // Positive is an improvement: a lower position number is better
  const improved =
    current.position === null || previous?.position == null ? null : previous.position - current.position;
  const places = improved === null ? null : formatDecimal(Math.abs(improved), 1);
  const position: MetricStripItem = {
    id: 'position',
    label: t('metrics.position'),
    value: formatDecimal(current.position, 1),
    ...(current.position === null ? { unknown: { kind: 'not-applicable' as const }, tip: noImpressions } : {}),
    context: before(formatDecimal(previous?.position, 1)),
    delta:
      improved === null || places === null || places === ZERO_PLACES ? null : (
        <span
          className={cn(
            'num type-meta',
            TONE[
              formatMetricDelta({
                value: improved,
                unit: 'count',
                polarity: 'higher_is_better',
                isDetectable: true,
              }).tone
            ],
          )}
        >
          {t(improved > 0 ? 'positionImproved' : 'positionSlipped', { places })}
        </span>
      ),
  };

  return (
    <MetricStrip
      size="sm"
      label={t('summaryLabel')}
      status={status}
      groups={[{ id: GROUP_ID, items: [count('clicks'), count('impressions'), ctr, position] }]}
    />
  );
}
