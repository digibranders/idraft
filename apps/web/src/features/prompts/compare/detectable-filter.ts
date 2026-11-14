import { topicRowKept } from '@/features/prompts/prompt-model';
import type { EngineSummary, PromptsSummary, PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import { averageChangeOf } from '@/lib/compare/change-model';

/**
 * The "Detectable changes only" chip (WB-TPF-07, decision D6): which rows have a Mention rate change larger than normal
 * variation. The change that decides a row is the one of the average of the engines shown, over the engines that have a
 * rate in both windows (D4, `averageChangeOf`), so a row with one engine is judged by that engine's own test. Pure.
 */

interface CellRow {
  engines: readonly EngineSummary[];
}

/** Whether the row's Mention change is larger than normal variation; no previous, too few answers and no test are not. */
const isDetectable = (row: CellRow, codes: readonly string[]): boolean =>
  averageChangeOf(row.engines, codes, 'mentioned')?.detectable === true;

/** The rows that changed by more than normal variation; none when comparison is off (there is nothing to read). */
const keepDetectable = <T extends CellRow>(rows: readonly T[], codes: readonly string[], compare: boolean): T[] =>
  compare ? rows.filter((row) => isDetectable(row, codes)) : [];

export const keepPromptRows = (
  rows: readonly PromptSummaryRow[],
  codes: readonly string[],
  compare: boolean,
): PromptSummaryRow[] => keepDetectable(rows, codes, compare);

export const keepTopicRows = (
  rows: readonly TopicSummaryRow[],
  codes: readonly string[],
  compare: boolean,
): TopicSummaryRow[] => keepDetectable(rows, codes, compare);

/**
 * The summary the Topics views are given while the chip is on: its topic rows are the kept ones. The prompt rows stay
 * whole, as a search leaves them: the table's footer counts the prompts in scope, and a topic opens onto all of its own.
 */
export const narrowSummary = (summary: PromptsSummary, codes: readonly string[], compare: boolean): PromptsSummary => ({
  ...summary,
  topics: keepTopicRows(summary.topics, codes, compare),
});

/**
 * How many rows of the tab have a change to read at all (a previous period, and a rate in both), among those a topic
 * filter leaves (`kept`, or null without one). The empty state says how many were compared; 0 means the previous
 * period gave nothing to compare with.
 */
export function comparedRowCount(
  summary: PromptsSummary | undefined,
  view: 'topics' | 'prompts',
  kept: ReadonlySet<string> | null,
  codes: readonly string[],
): number {
  if (summary === undefined) return 0;
  const inScope: CellRow[] =
    view === 'topics'
      ? summary.topics.filter((row) => kept === null || topicRowKept(row.term_id, kept))
      : summary.prompts.filter((row) => kept === null || row.topic_term_ids.some((id) => kept.has(id)));
  return inScope.filter((row) => averageChangeOf(row.engines, codes, 'mentioned') !== null).length;
}
