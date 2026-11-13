import type { SourceChangePage, SourceChangeRow, SourcesMeta } from '@/lib/citations/types';

/**
 * What the New and lost list works out from its reads (docs/16 C5 and C6): the id of a row, the days a read
 * covers, whether the previous period can say anything, and which rows and counts are shown. Pure.
 */

const DAY_MS = 86_400_000;

/** A row's id: its domain, its role and the entity whose rule matched, as the Domains table tells its rows apart. */
export const changeRowId = (row: SourceChangeRow): string =>
  `${row.registrable_domain}|${row.domain_role}|${row.role_entity_id ?? ''}`;

/** The days a window covers, both ends counted: 2026-10-16 to 2026-11-12 is 28 days. */
export function daysIn({ from, to }: { from: string; to: string }): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

/** The days of the window before the asked one, which New compares with. */
export const previousDays = (meta: SourceChangePage['meta']): number => daysIn(meta.compare_window);

/**
 * The days of answers `kind=lost` reads: its `window` is the asked window and the one before it, and its
 * `compare_window` the support window before those, so a 92 day ask reads 276 days.
 */
export const lostDays = (meta: SourceChangePage['meta']): number =>
  daysIn({ from: meta.compare_window.from, to: meta.window.to });

/** One of the three windows of a lost read. */
export const lostWindowDays = (meta: SourceChangePage['meta']): number => Math.round(lostDays(meta) / 3);

/**
 * The previous period has no answers: every cited domain would read as new, so no row is listed and no count is
 * drawn. Not known while the scope read has not answered, so a failed strip does not hide a list that was read.
 */
export const noPreviousAnswers = (scope: SourcesMeta | undefined): boolean =>
  scope !== undefined && (scope.previous_answers ?? 0) === 0;

/** The rows to list: none without a read, and none when the previous period has no answers. */
export function rowsOf(page: SourceChangePage | undefined, noPrevious: boolean): readonly SourceChangeRow[] {
  return page === undefined || noPrevious ? [] : page.data;
}

/** The count of a kind: the server's total, or `null` (n/a) when it is not read or the previous period says nothing. */
export const totalOf = (page: SourceChangePage | undefined, noPrevious: boolean): number | null =>
  page === undefined || noPrevious ? null : page.page.total;

/** How many rows are listed of how many, when the list is cut; `null` when it is whole. */
export function truncatedOf(page: SourceChangePage | undefined): { shown: number; total: number } | null {
  return page !== undefined && page.page.total > page.data.length
    ? { shown: page.data.length, total: page.page.total }
    : null;
}
