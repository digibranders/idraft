import type { CitationRow } from './types';

/** The citation rows of one answer, in the order of the list (its source order). */
export interface AnswerCitations {
  observationId: string;
  rows: readonly CitationRow[];
  /** The rows in the answer: the "M" of "Source N of M". */
  count: number;
}

/**
 * Groups the rows of the citation list by answer, in the order the list gives them. The list is cut by rows, so
 * when `hasMore` the last answer may be incomplete and is dropped; an answer shown from part of its rows would
 * say "Source 2 of 4" when it has 9.
 */
export function groupByAnswer(rows: readonly CitationRow[], hasMore: boolean): AnswerCitations[] {
  const byAnswer = new Map<string, CitationRow[]>();
  for (const row of rows) {
    const group = byAnswer.get(row.observation_id);
    if (group === undefined) byAnswer.set(row.observation_id, [row]);
    else group.push(row);
  }
  const groups = [...byAnswer].map(([observationId, group]) => ({
    observationId,
    rows: group,
    count: group.length,
  }));
  return hasMore ? groups.slice(0, -1) : groups;
}

/**
 * The place of a source in its answer: its `citation_index` of the rows in the answer. Said "Source 2 of 9";
 * it is the order the engine listed the sources in, never a rank.
 */
export const positionOf = (
  row: Pick<CitationRow, 'citation_index'>,
  answerRows: readonly CitationRow[],
): { index: number; count: number } => ({ index: row.citation_index, count: answerRows.length });
