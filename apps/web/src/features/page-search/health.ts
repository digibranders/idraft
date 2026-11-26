import type { BadgeProps } from '@/components/ui/badge';

import type { PageHealth, Verdict } from './types';

/** The verdicts in the order the Health filter lists them and the table sorts them: the pages that need attention first. */
export const HEALTH_ORDER: readonly Verdict[] = [
  'lost',
  'sharp_drop',
  'declining',
  'stable',
  'growing',
  'new',
  'no_data',
  'low_data',
];

/** A verdict whose pages lost traffic: the bigger loss is the one to see first. */
const LOSSES: ReadonlySet<Verdict> = new Set<Verdict>(['lost', 'sharp_drop', 'declining']);

/** The verdict decides the order; inside it, the bigger loss or gain (`absolute`) comes first. Smaller sorts first. */
export function attentionOrder(health: PageHealth): number {
  const base = HEALTH_ORDER.indexOf(health.verdict) * 1e9;
  return LOSSES.has(health.verdict) ? base + health.absolute : base - health.absolute;
}

type BadgeTone = NonNullable<BadgeProps['tone']>;

const TONES: Readonly<Record<Verdict, BadgeTone>> = {
  lost: 'negative',
  sharp_drop: 'negative',
  declining: 'warning',
  stable: 'neutral',
  growing: 'positive',
  new: 'info',
  // The Badge has no "insufficient" tone, so a page without enough traffic is neutral like one without numbers.
  no_data: 'neutral',
  low_data: 'neutral',
};

export const healthTone = (verdict: Verdict): BadgeTone => TONES[verdict];

/** The keys under `pageSearch.verdict` that hold the sentence of a verdict. */
export type VerdictMessage =
  | 'lost'
  | 'sharp_drop'
  | 'declining'
  | 'growing'
  | 'stable'
  | 'stableAlone'
  | 'new'
  | 'lowData'
  | 'smallNumbers'
  | 'noData';

/** The sentence of a verdict; `compared` is false when the period is shown without a comparison. */
export function verdictMessage(health: PageHealth, compared: boolean): VerdictMessage {
  switch (health.verdict) {
    case 'stable':
      return compared ? 'stable' : 'stableAlone';
    case 'low_data':
      return health.small ? 'smallNumbers' : 'lowData';
    case 'no_data':
      return 'noData';
    default:
      return health.verdict;
  }
}
