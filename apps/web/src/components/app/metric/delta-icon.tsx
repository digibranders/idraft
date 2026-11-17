'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { hasDeltaComparison, type DeltaTest } from './delta';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { formatMetricDelta, type ChangeTone, type MetricDeltaInput } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The colour of a change by the tone `formatMetricDelta` gives it, as `Delta` does: never by the sign. */
const TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground-secondary'),
} as const satisfies Record<ChangeTone, string>;

export interface DeltaIconProps {
  input: MetricDeltaInput;
  /** `interim` while the API sends no `is_detectable`. Default `paired`. */
  test?: DeltaTest | undefined;
  /**
   * The figures (the points, the value before and now, the verdict) as a tooltip. The icon is then a tab stop that
   * opens it. Leave it out where the cell or card that holds the icon already carries the tooltip.
   */
  tip?: string | undefined;
  /** The `data-slot` of the icon, for the screens that find it by name. */
  slot?: string | undefined;
}

/**
 * A change between two periods drawn as an icon: a line trending up or down, and a dash when it rounds to nothing.
 * The icon always says the direction; it is green or red only when the change is detectable, so a wobble does not
 * look like news. A screen reader hears the change in words with what the test found. Nothing is drawn without a
 * comparison: an unknown change is not a flat one.
 */
export function DeltaIcon({ input, test = 'paired', tip, slot = 'delta-icon' }: DeltaIconProps): ReactElement | null {
  const t = useTranslations('common.delta');
  if (!hasDeltaComparison(input)) return null;
  const display = formatMetricDelta(input);
  const direction = display.label === 'no change' ? 'flat' : (input.value ?? 0) > 0 ? 'up' : 'down';
  const spoken = [display.label];
  if (input.isDetectable !== null) {
    spoken.push(input.isDetectable ? t('detectable') : t('withinVariation'));
    if (test === 'interim') spoken.push(t('interim'));
  }
  const tipped = tip !== undefined && tip !== '';
  return (
    <Tooltip content={tip ?? ''} disabled={!tipped}>
      <span
        data-slot={slot}
        data-direction={direction}
        // An icon with a tooltip is a tab stop that opens it (20 section 6.2 rule 6); the lint rule cannot see why
        {...(tipped ? { tabIndex: 0 } : {})}
        className={cn(
          'relative inline-flex shrink-0 self-center',
          TONE[display.tone],
          tipped && 'rounded-xs outline-none focus-visible:focus-ring',
        )}
      >
        <Icon icon={direction === 'flat' ? Minus : direction === 'up' ? TrendingUp : TrendingDown} size="sm" />
        <span className="sr-only">{spoken.join(', ')}</span>
      </span>
    </Tooltip>
  );
}
