import type { CitationsTranslate } from '../board-text';
import type { BoardSort } from '@/components/app/table/board-table';
import type { CitationGapRow } from '@/lib/citations/board-queries';

type Brand = CitationGapRow['you'];
type BrandState = Brand['total']['state'];

/** Lost on, descending (C 32). */
export const GAP_SORT_DEFAULT: BoardSort = { key: 'gap', dir: 'desc' };
const RANK: Readonly<Record<BrandState, number>> = { cited: 3, mentioned: 2, not: 1, none: 0 };

/** Only gaps and the search (C 612): the prompt's text or its group's name, case ignored. */
export function visibleGapRows(
  rows: readonly CitationGapRow[],
  { gapsOnly, search }: { gapsOnly: boolean; search: string },
): CitationGapRow[] {
  const needle = search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!gapsOnly || row.gap > 0) &&
      (needle === '' ||
        row.text.toLowerCase().includes(needle) ||
        (row.topic?.name.toLowerCase().includes(needle) ?? false)),
  );
}

/** A text, or numbers compared one after the other: a count never spills into the next field. */
type SortValue = string | readonly number[];

function sortValue(row: CitationGapRow, key: string): SortValue | null {
  if (key === 'prompt') return row.text;
  if (key === 'topic') return row.topic?.name ?? null;
  if (key === 'you') return [RANK[row.you.total.state], row.you.cited_on, row.you.total.cited];
  if (key.startsWith('c:')) {
    const id = key.slice(2);
    return [row.competitors.find((competitor) => competitor.entity_id === id)?.total.cited ?? 0];
  }
  return [row.gap, row.lost_to.length, row.competitor_answers];
}

function compareValues(x: SortValue, y: SortValue): number {
  if (typeof x === 'string' || typeof y === 'string')
    return typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : 0;
  for (const [index, field] of x.entries()) {
    const difference = field - (y[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The sorts of C 613 to 620; ties by prompt text; a prompt with no group is last both ways (D-10). */
export function sortGapRows(rows: readonly CitationGapRow[], sort: BoardSort): CitationGapRow[] {
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (x === null || y === null) return x === y ? a.text.localeCompare(b.text) : x === null ? 1 : -1;
    const order = compareValues(x, y);
    return (sort.dir === 'asc' ? order : -order) || a.text.localeCompare(b.text);
  });
}

/** One brand on one engine as a sentence (C 582 to 587). */
function line(cell: Brand['engines'][number], label: string, t: CitationsTranslate): string {
  if (cell.answers === 0) return t('marks.lineNone', { engine: label });
  if (cell.cited > 0) return t('marks.lineCited', { engine: label, k: cell.cited, n: cell.answers });
  if (cell.mentioned > 0) return t('marks.lineMentioned', { engine: label, m: cell.mentioned, n: cell.answers });
  return t('marks.lineNot', { engine: label, n: cell.answers });
}

/** The mark's tooltip: one sentence per engine, joined by ". " (C 602 to 604). */
export const markLines = (
  brand: Pick<Brand, 'engines'>,
  labelOf: (code: string) => string,
  t: CitationsTranslate,
): string => brand.engines.map((cell) => line(cell, labelOf(cell.engine_code), t)).join('. ');

/** Only your mark has a tone; a competitor's is the text colour when cited (C 596 to 598). */
export function markTone(state: BrandState, { own, lost }: { own: boolean; lost: boolean }): string {
  const cited = state === 'cited';
  if (!own) return cited ? 'text-foreground' : 'text-foreground-tertiary';
  if (cited) return lost ? 'text-warning-text' : 'text-positive-text';
  return lost ? 'text-negative-text' : 'text-foreground-tertiary';
}

/** "Lost on ChatGPT, Gemini to HubSpot, Pipedrive" (C 661). */
export const lostTip = (
  row: CitationGapRow,
  labelOf: (code: string) => string,
  nameOf: (id: string) => string,
  t: CitationsTranslate,
): string =>
  t('gaps.lostTip', { engines: row.lost_on.map(labelOf).join(', '), names: row.lost_to.map(nameOf).join(', ') });
