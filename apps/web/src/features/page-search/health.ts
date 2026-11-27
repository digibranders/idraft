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

/** Wider than any `absolute` (clicks or impressions of one page in at most 92 days), so the bands never overlap. */
const BAND = 1e12;

/**
 * The verdict decides the order. Inside it the pages judged on clicks come before the ones judged on impressions,
 * because `absolute` is in the unit of `basis` and the two cannot be compared; inside a basis the bigger loss or gain
 * comes first. Smaller sorts first.
 */
export function attentionOrder(health: PageHealth): number {
  const base = (HEALTH_ORDER.indexOf(health.verdict) * 2 + (health.basis === 'clicks' ? 0 : 1)) * BAND;
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

/** The keys under `pageSearch.verdict` that hold the sentence of a verdict (catalog keys are camelCase). */
export type VerdictMessage =
  | 'lost'
  | 'sharpDrop'
  | 'declining'
  | 'growing'
  | 'growingFromZero'
  | 'stable'
  | 'stableAlone'
  | 'new'
  | 'lowData'
  | 'lowDataAlone'
  | 'smallNumbers'
  | 'noData';

/**
 * The sentence of a verdict. `compared` is whether the answer has numbers to compare with (`previous !== null`), not
 * whether a comparison was asked for: a compared period before the page's history has none, and its sentence must
 * not name one. A page that grew from nothing has no percentage (`change` is null), so it has its own sentence.
 */
export function verdictMessage(health: PageHealth, compared: boolean): VerdictMessage {
  switch (health.verdict) {
    case 'stable':
      return compared ? 'stable' : 'stableAlone';
    case 'growing':
      return health.change === null ? 'growingFromZero' : 'growing';
    case 'sharp_drop':
      return 'sharpDrop';
    case 'low_data':
      return health.small ? 'smallNumbers' : compared ? 'lowData' : 'lowDataAlone';
    case 'no_data':
      return 'noData';
    case 'lost':
    case 'declining':
    case 'new':
      return health.verdict;
  }
}
