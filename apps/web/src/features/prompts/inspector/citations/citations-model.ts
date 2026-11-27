import { STALE_AFTER_DAYS } from '../../history-model';
import type { FaviconMode } from '@/components/app/cells/domain-cell';
import { isNewSource } from '@/lib/citations/share-model';
import type { DomainRole, SourceChangePage, SourcesMeta } from '@/lib/citations/types';

/**
 * What the Citations tab of the prompt inspector decides from its reads (WB-PIC-01 to 04, 10). Pure: numbers and
 * rows in, rows out, no text. The shares themselves come from `@/lib/citations/share-model`.
 */

/** The engine choice that reads every enabled engine; any other value is an engine code. */
export const ALL_ENGINES = 'all';

/** Favicons are shown everywhere until the project setting exists (plan D16). */
export const FAVICON: FaviconMode = 'show';

/**
 * The widest the identity cell of a row grows (a class, so the table's other columns stay in view): a table cell does
 * not shrink its text by itself. The drawer is 480 to 960 px wide, so the cap steps with the width of the table's box
 * (a container query on the box that holds the table) and a wider card shows more of the domain or the path.
 */
export const IDENTITY_WIDTH = 'max-w-32 @md:max-w-48 @xl:max-w-64 @3xl:max-w-96';

/**
 * The cited page of an answer shares the table with the date and the Others count, and its path keeps 16 characters
 * in view on a phone, so there it is capped under `IDENTITY_WIDTH` (the path is whole in its tooltip); from a tablet
 * it steps with the table's box as the identity cell does.
 */
export const ANSWER_PAGE_WIDTH = 'max-w-20 sm:max-w-32 @md:max-w-48 @xl:max-w-64 @3xl:max-w-96';

/** The lists name the five most cited. */
export const TOP_LIMIT = 5;

/**
 * The lists are counted in answers that cite a row (register PR-DRAWER-08, rule R11), so no row is left out by a
 * minimum of citation units: that threshold is of another unit than the number each row shows.
 */
export const MIN_SUPPORT = 1;

const DAY_MS = 86_400_000;

export interface TopRow<TRow> {
  row: TRow;
  /** Cited now and not in the period before, which had answers to cite from. */
  isNew: boolean;
}

export interface TopRows<TRow> {
  rows: TopRow<TRow>[];
  /** False when the previous period has no answers: nothing can be told New, and the tab says so. */
  previousKnown: boolean;
}

/** The first `TOP_LIMIT` rows of a read, each with its New marker. */
export function topRows<TRow extends Parameters<typeof isNewSource>[0]>(
  rows: readonly TRow[],
  meta: Pick<SourcesMeta, 'previous_answers'>,
  minSupport: number,
): TopRows<TRow> {
  return {
    rows: rows.slice(0, TOP_LIMIT).map((row) => ({ row, isNew: isNewSource(row, meta, minSupport) === true })),
    previousKnown: (meta.previous_answers ?? 0) > 0,
  };
}

/** The own domain is cited in none of the answers read, though there are answers (0 answers is "nothing to count"). */
export function notCited(meta: Pick<SourcesMeta, 'answers' | 'by_role'>): boolean {
  const own = meta.by_role.find((entry) => entry.domain_role === 'own');
  return meta.answers > 0 && (own?.observations ?? 0) === 0;
}

export interface LostRow {
  key: string;
  domain: string;
  role: DomainRole;
}

/** The lost domains of a `sources/changes` read. Named without a count: the read has units, the lists count answers. */
export function lostRows(page: Pick<SourceChangePage, 'data'>): LostRow[] {
  return page.data.map((row) => ({
    key: `${row.registrable_domain}:${row.domain_role}:${row.role_entity_id ?? ''}`,
    domain: row.registrable_domain,
    role: row.domain_role,
  }));
}

/** The last valid answer when it is `STALE_AFTER_DAYS` days old or more, else null (also for no valid answer at all). */
export function staleSince(lastValidAt: string | null | undefined, now: Date): string | null {
  if (lastValidAt === null || lastValidAt === undefined) return null;
  return now.getTime() - Date.parse(lastValidAt) >= STALE_AFTER_DAYS * DAY_MS ? lastValidAt : null;
}
