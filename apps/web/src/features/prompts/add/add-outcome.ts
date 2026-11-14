import type { ClassifiedLine } from './add-model';
import type { Outcome, OutcomeLine } from './add-result';
import type { PromptBulkResult } from '@/lib/api/types';

/**
 * What the add came to, as lines (prompt-dialogs 4.6), from what the check said before it and what the API answered.
 * Pure. The API's `index` counts the lines that were sent, which are the ones the check found new, in order.
 */

export interface OutcomeInput {
  /** The language of the lines, for `lang`. */
  language: string;
  /** Every line the check read, tracked and archived ones too. */
  lines: readonly ClassifiedLine[];
  /** The lines that were sent, in order. */
  sent: readonly ClassifiedLine[];
  /** What `bulk-create` answered; empty when only archived prompts were brought back. */
  result: PromptBulkResult;
  /** One refusal in words. */
  reasonOf: (entry: PromptBulkResult['rejected'][number]) => string;
  restore: {
    /** The archived lines were to be brought back. */
    on: boolean;
    /** How many the API brought back. */
    done: number;
    /** Why it failed; `null` when it did not. */
    failure: string | null;
  };
}

const lineOf = (line: ClassifiedLine): OutcomeLine => ({ line: line.line, text: line.text, promptId: line.promptId });

export function outcomeOf({ language, lines, sent, result, reasonOf, restore }: OutcomeInput): Outcome {
  const sentAt = (index: number): OutcomeLine => {
    const found = sent[index];
    return { line: found?.line ?? index + 1, text: found?.text ?? '', promptId: null };
  };
  const archived = lines.filter((line) => line.group === 'archived').map(lineOf);
  const failed = restore.on && restore.failure !== null;
  return {
    language,
    created: result.created,
    // The check knew some; the others were added by someone else while the dialog was open
    tracked: [
      ...lines.filter((line) => line.group === 'tracked').map(lineOf),
      ...result.skipped.map((entry) => ({ ...sentAt(entry.index), promptId: entry.existing_id })),
    ].sort((a, b) => a.line - b.line),
    archived: restore.on ? [] : archived,
    rejected: result.rejected.map((entry) => ({ ...sentAt(entry.index), reason: reasonOf(entry) })),
    restored: restore.on && !failed ? restore.done : 0,
    restoreFailed: failed && restore.failure !== null ? { lines: archived, reason: restore.failure } : null,
  };
}

/** The result view takes the form's place when the API skipped or refused a line, or could not restore. */
export const needsResultView = (result: PromptBulkResult, outcome: Outcome): boolean =>
  result.skipped.length > 0 || result.rejected.length > 0 || outcome.restoreFailed !== null;
