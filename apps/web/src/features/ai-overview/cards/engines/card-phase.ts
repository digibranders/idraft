import type { Read } from '../../data/read-state';

/**
 * What state a card of the engines family is in, from its reads (WP-34 plan section 3.4). Pure: the card's
 * `ChartFrame` takes `phase` as its `status`. A card that is `refetching` keeps its values on screen, a change between
 * two windows of one scope too (`useCardData` drops the previous window only while the reads are of two scopes).
 */

/** Whether a card reads the window before: not at all, as an extra it can do without, or as what it is made of. */
export type PreviousNeed = 'none' | 'optional' | 'required';

/** The statuses of `ChartFrame`. */
export type CardPhase = 'loading' | 'ready' | 'refetching' | 'empty' | 'error';

type ReadFacts = Pick<Read<unknown>, 'status' | 'stale'>;

export interface PhaseInput {
  current: ReadFacts;
  /** `null` when the comparison is off or its window cannot be asked: it is not read, by design. */
  previous: ReadFacts | null;
  need: PreviousNeed;
  /** No read of the page's summary is loading or holds the last scope's data (`OverviewPeriods.settled`). */
  settled: boolean;
  /** The reads answered with something this card can draw. */
  hasContent: boolean;
}

export interface PhaseResult {
  phase: CardPhase;
  /** A later read of what is shown failed: the figures are the last that were read. */
  stale: boolean;
  /** The previous window could not be read on a card that shows without it: its changes are `n/a`. */
  partialPrevious: boolean;
}

export function cardPhase({ current, previous, need, settled, hasContent }: PhaseInput): PhaseResult {
  // The reads the card is made of: the previous window only for a card that cannot show without it
  const required: readonly ReadFacts[] = need === 'required' && previous !== null ? [current, previous] : [current];
  const stale = required.some((read) => read.stale);
  const partialPrevious = need === 'optional' && previous?.status === 'error';
  const result = (phase: CardPhase): PhaseResult => ({ phase, stale, partialPrevious });

  if (required.some((read) => read.status === 'error')) return result('error');
  if (current.status === 'idle') return result('empty');
  if (required.some((read) => read.status === 'loading')) return result('loading');
  // A card made of a comparison has nothing to show where the comparison is off
  if (need === 'required' && previous === null) return result('empty');
  // Data is on screen while a read runs; the data may be of the last scope (`!settled`), so it is not judged empty
  // yet. A paused read (idle, or ready from its cache) is not under way, so it is judged like any other
  if (!settled || required.some((read) => read.status === 'refetching')) return result('refetching');
  return result(hasContent ? 'ready' : 'empty');
}
