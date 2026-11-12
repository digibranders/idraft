import type { ObservationSummary, PromptSummaryRow, SummaryEntity } from '@/lib/api/types';
import type { ErrorIdWords } from '@/lib/api/use-error-id';

/** What the screen has of the prompt's counts: the summary of the window the page is on. */
export interface PromptCounts {
  status: 'loading' | 'failed' | 'ready';
  /** The prompt's row; `undefined` for a prompt the summary leaves out (a branded one, or one with no answer). */
  row: PromptSummaryRow | undefined;
  /** The tracked entity set of the summary: the own brand and the competitors, with their roles. */
  entities: readonly SummaryEntity[];
  /** Whether the summary includes the branded prompts (the Branded filter). */
  brandedIncluded: boolean;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
}

/** The prompt's answers in the window of the page (one read, newest first, 200 at most), which three of the tabs draw on. */
export interface PromptAnswers {
  status: 'loading' | 'error' | 'ready';
  rows: readonly ObservationSummary[];
  /** The API has more answers than the list holds. */
  hasMore: boolean;
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
}
