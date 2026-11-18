import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { formatMetricDelta, type ChangeTone, type MetricDeltaInput } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground-secondary'),
} as const satisfies Record<ChangeTone, string>;

/** A change of a rate that rounds to nothing: under half a hundredth of a point. */
export const FLAT_CHANGE = 0.0005;

export interface TrendIconProps {
  /** A change in points; the tone comes from `formatMetricDelta`, so it is coloured only when detectable. */
  input: MetricDeltaInput;
  /** What a screen reader says in its place: "Up 2.5 pts, within normal variation". */
  spoken: string;
}

/**
 * The change of a rate as a trend icon, as price tables show it: up, down, or a minus when it rounds to nothing.
 * The figures are the tooltip of what holds it; shape and colour are said in words too.
 */
export function TrendIcon({ input, spoken }: TrendIconProps): ReactElement {
  const value = input.value ?? 0;
  const direction = Math.abs(value) < FLAT_CHANGE ? 'flat' : value > 0 ? 'up' : 'down';
  const { tone } = formatMetricDelta(direction === 'flat' ? { ...input, value: 0 } : input);
  return (
    <span data-direction={direction} className={cn('inline-flex shrink-0 self-center', TONE[tone])}>
      <Icon icon={direction === 'flat' ? Minus : direction === 'up' ? TrendingUp : TrendingDown} size="sm" />
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
