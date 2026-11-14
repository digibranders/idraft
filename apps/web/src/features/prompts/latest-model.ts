import type { ObservationSummary } from '@/lib/api/types';

/**
 * Small facts of the answers the prompt inspector reads. Plain data; the tabs put words and cells to it.
 */

/** An answer counts in the rates when its facts are read and say it is valid (a failed or refused one has none). */
export const isValidAnswer = (answer: ObservationSummary): boolean => answer.facts?.is_valid === true;

/** The key of how an answer's mention order is said ("Mentioned third among the tracked brands"); past the third, a number. */
export const mentionOrderKey = (order: number): 'first' | 'second' | 'third' | 'other' =>
  order === 1 ? 'first' : order === 2 ? 'second' : order === 3 ? 'third' : 'other';
