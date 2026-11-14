import { comparisonWindow } from '../../data/overview-queries';
import type { TopicData } from './model-types';

export interface Gated {
  /** The data the frame is given: its phase may be held back from the read's own. */
  data: TopicData;
  /** The comparison is off (or its window cannot be asked): there is no previous window to wait for. */
  compareOff: boolean;
}

/**
 * The phase of a card that needs both windows. Rows hold back (loading) while the vocabulary tree is pending, because
 * leaf and top level topics depend on it. With the comparison on, no change is drawn until the two reads are paired
 * for the same scope (`data.compared`): while they are not, the card is loading, or an error when the window before
 * failed, and never a change made from one window and an old other one.
 */
export function gateComparison(read: TopicData, needsPrevious: boolean): Gated {
  const showing = read.phase === 'ready' || read.phase === 'refetching';
  const compareOff = comparisonWindow(read.scope) === null;
  if (!showing) return { data: read, compareOff };
  if (read.tree.pending) return { data: { ...read, phase: 'loading' }, compareOff };
  if (needsPrevious && !compareOff && !read.compared) {
    const failed = read.settled && read.errorId !== null;
    return { data: { ...read, phase: failed ? 'error' : 'loading' }, compareOff };
  }
  return { data: read, compareOff };
}
