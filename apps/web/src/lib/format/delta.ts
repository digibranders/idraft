/**
 * Metric change classification (rates, counts, money). Rank changes live in rank.ts.
 * Rule: color only when the change is detectable (AI rates: the API's `is_detectable`; SEO aggregates:
 * outside 2 standard deviations of their own daily changes). Otherwise neutral.
 * Spec: docs/design-system/02-color-system.md section 6 and 22-content-formatting.md section 2.
 */
import type { ChangeTone } from './rank';
import { formatPointsDelta, formatRelativeChange, formatSignedInteger, EMPTY_VALUE } from './number';

export type Polarity =
  | 'higher_is_better' // mention rate, citation rate, visibility, top-10 count
  | 'lower_is_better' // failure rate, stale keyword count
  | 'neutral'; // cost, volume, observation counts: change is information, not judgment

export type DeltaUnit = 'points' | 'relative' | 'count';

export interface MetricDeltaInput {
  value: number | null;
  unit: DeltaUnit;
  polarity: Polarity;
  /** true, false, or null when no detectability test exists for this metric. */
  isDetectable: boolean | null;
}

export interface MetricDeltaDisplay {
  text: string;
  label: string;
  tone: ChangeTone;
  /** Text appended in tooltips when not detectable. */
  note: string | null;
}

export function formatMetricDelta(input: MetricDeltaInput): MetricDeltaDisplay {
  const { value, unit, polarity, isDetectable } = input;
  if (value === null || !Number.isFinite(value)) {
    return { text: EMPTY_VALUE, label: 'change not available', tone: 'neutral', note: null };
  }
  const text =
    unit === 'points'
      ? formatPointsDelta(value)
      : unit === 'relative'
        ? formatRelativeChange(value)
        : formatSignedInteger(value);
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';

  let tone: ChangeTone = 'neutral';
  if (isDetectable === true && direction !== 'flat' && polarity !== 'neutral') {
    const good = (direction === 'up') === (polarity === 'higher_is_better');
    tone = good ? 'positive' : 'negative';
  }
  const note = isDetectable === false ? 'Within normal variation' : null;
  const label =
    direction === 'flat' ? 'no change' : `${direction === 'up' ? 'up' : 'down'} ${text.replace(/^[+−]/, '')}`;
  return { text, label, tone, note };
}
