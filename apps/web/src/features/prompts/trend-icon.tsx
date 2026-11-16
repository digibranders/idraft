'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useCompare } from './compare/use-compare';
import { Icon } from '@/components/ui/icon';
import { deltaInput, type RateChange } from '@/lib/compare/change-model';
import { formatMetricDelta, type ChangeTone } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The colour of a change drawn as an icon, by the tone `formatMetricDelta` gives it, as `Delta` does for the points:
 * green or red only when the change is detectable (R5), never by the sign. The shared components have no icon form of
 * `Delta` yet; when one exists this file becomes a call to it, and the scan of colour classes in
 * compare/colour-rule.test.tsx takes this file in.
 */
const TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground-secondary'),
} as const satisfies Record<ChangeTone, string>;

export interface TrendIconProps {
  /** How the rate moved; `null` where it is not known. */
  change: RateChange | null;
}

/**
 * The change of a rate in a cell of the Prompts table as an icon, as price tables show it: a line trending up or
 * down, and a dash when the change rounds to nothing. The icon always says the direction; it is green or red only when
 * the change is detectable, so a wobble does not look like news. The figures (the points, the rate before and now, the
 * verdict, the weekly rates) are in the cell's tooltip, which is what the keyboard reaches; the icon says the direction
 * and the verdict in the words `Delta` speaks. Nothing is drawn while the comparison is off or the change is not
 * known: an unknown change is not a flat one.
 */
export function TrendIcon({ change }: TrendIconProps): ReactElement | null {
  const { compare } = useCompare();
  const delta = useTranslations('common.delta');
  if (!compare || change === null) return null;
  const input = deltaInput(change);
  const display = formatMetricDelta(input);
  const direction = display.label === 'no change' ? 'flat' : (input.value ?? 0) > 0 ? 'up' : 'down';
  const spoken = [display.label];
  if (input.isDetectable !== null) {
    spoken.push(input.isDetectable ? delta('detectable') : delta('withinVariation'), delta('interim'));
  }
  return (
    <span
      data-slot="trend-icon"
      data-direction={direction}
      className={cn('relative inline-flex shrink-0 self-center', TONE[display.tone])}
    >
      <Icon icon={direction === 'flat' ? Minus : direction === 'up' ? TrendingUp : TrendingDown} size="sm" />
      <span className="sr-only">{spoken.join(', ')}</span>
    </span>
  );
}
