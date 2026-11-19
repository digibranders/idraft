import { parseCsv } from '@/lib/csv/csv';

/** The API reads at most this many rows (plan 02 `too_many_rows`). */
export const MAX_CSV_ROWS = 20_000;
/** The API takes a CSV body of at most this many characters (`CSV_MAX` of the backend schema). */
export const MAX_CSV_CHARS = 900_000;

/** The API refuses a request body over this many bytes (1 MiB), 413 before it reads the text. */
export const MAX_BODY_BYTES = 1_048_576;

/** The size of the request body that carries `text`, as it is sent. */
export const requestBytes = (text: string): number => new TextEncoder().encode(JSON.stringify({ csv: text })).length;

export interface CsvTier {
  tier_id: string;
  code: string;
  name: string;
}

export interface CsvTierRow {
  line: number;
  url: string;
  /** `null` is Untiered, set by hand. */
  tierId: string | null;
}

export interface CsvTierError {
  line: number;
  code:
    | 'unknown_tier'
    | 'missing_column'
    | 'too_many_rows'
    | 'invalid_url'
    | 'missing_header'
    | 'too_large'
    | 'body_too_large';
  /** The tier text that did not match; empty for the other codes. */
  value: string;
}

export interface TierCsvOptions {
  /**
   * The rules of the API: a header line that names `url` and `tier` (in any order), and an absolute http or https
   * address on every row. Without it a header is optional and a path such as `/pricing` is read as it stands.
   */
  strict?: boolean;
}

/** A spreadsheet export may start with a byte order mark. */
const BOM = String.fromCharCode(0xfeff);
const NONE = new Set(['none', 'untiered']);
const squash = (text: string): string => text.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

const isHeader = (cells: readonly string[]): boolean =>
  cells[0]?.trim().toLowerCase() === 'url' && cells[1]?.trim().toLowerCase() === 'tier';

function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * The Check step of the CSV import (spec 5.2, decision W14): one page per line, `url` then `tier` (a code such as
 * T1, a name such as Money pages, a label such as T1 Money pages, `none` or `Untiered`, any letter case), an
 * optional header line, blank lines skipped. Line numbers are the lines of the text, so the errors point where the
 * person typed. Whether a URL is in the crawl, and whether it is a page of this site, is the API's answer
 * (`pending`, `other_site`), not this check's. The text is read whole, on the page's thread: the size cap and the
 * row cap keep that to a few milliseconds.
 */
export function parseTierCsv(
  text: string,
  tiers: readonly CsvTier[],
  options: TierCsvOptions = {},
): { rows: CsvTierRow[]; errors: CsvTierError[] } {
  const strict = options.strict === true;
  if (text.length > MAX_CSV_CHARS) return { rows: [], errors: [{ line: 1, code: 'too_large', value: '' }] };
  // Characters can weigh up to four bytes, and the request wraps the text in JSON: the body is what the API caps
  if (requestBytes(text) > MAX_BODY_BYTES)
    return { rows: [], errors: [{ line: 1, code: 'body_too_large', value: '' }] };
  // A code or Untiered is looked up before a name or a label; a name two tiers share names none
  const byCode = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const tier of tiers) {
    byCode.set(squash(tier.code), tier.tier_id);
    for (const name of [squash(tier.name), squash(`${tier.code} ${tier.name}`)]) {
      byName.set(name, byName.has(name) ? null : tier.tier_id);
    }
  }
  const rows: CsvTierRow[] = [];
  const errors: CsvTierError[] = [];
  // Lines end in LF, CRLF or a lone CR, as `parseCsv` reads them
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r\n|\r|\n/);
  let counted = 0;
  let started = false;
  let urlAt = 0;
  let tierAt = 1;
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    // A line is one record: a quote left open means a cell that runs over a line break, which the Check refuses
    const open = (raw.match(/"/g)?.length ?? 0) % 2 === 1;
    const cells = open ? [raw] : parseCsv(raw)[0];
    // The API reads the first record as the header, blank or not: a blank first line is a missing header
    if (cells === undefined) {
      if (strict && index === 0) return { rows: [], errors: [{ line, code: 'missing_header', value: '' }] };
      continue;
    }
    // The header is the first line with anything on it
    const first = !started;
    started = true;
    if (first && strict) {
      const names = cells.map((cell) => cell.trim().toLowerCase());
      // A name the header repeats belongs to its last column, as in the API
      urlAt = names.lastIndexOf('url');
      tierAt = names.lastIndexOf('tier');
      if (urlAt < 0 || tierAt < 0) return { rows: [], errors: [{ line, code: 'missing_header', value: '' }] };
      continue;
    }
    // The API skips a line with nothing in any cell
    if (strict && !open && cells.every((cell) => cell.trim() === '')) continue;
    if (first && isHeader(cells)) continue;
    counted += 1;
    if (counted > MAX_CSV_ROWS) {
      errors.push({ line, code: 'too_many_rows', value: '' });
      break;
    }
    const url = open ? '' : (cells[urlAt]?.trim() ?? '');
    const tierText = open ? '' : (cells[tierAt]?.trim() ?? '');
    if (url === '' || tierText === '') {
      errors.push({ line, code: 'missing_column', value: '' });
      continue;
    }
    if (strict && !isWebAddress(url)) {
      errors.push({ line, code: 'invalid_url', value: '' });
      continue;
    }
    const key = squash(tierText);
    const tierId = NONE.has(key) ? null : (byCode.get(key) ?? byName.get(key) ?? undefined);
    if (tierId === undefined) errors.push({ line, code: 'unknown_tier', value: tierText });
    else rows.push({ line, url, tierId });
  }
  // An empty text has no header to find
  if (strict && !started) return { rows: [], errors: [{ line: 1, code: 'missing_header', value: '' }] };
  return { rows, errors };
}

/** Rows per tier id, `null` for Untiered, in the order the tiers first appear. */
export function countByTier(rows: readonly CsvTierRow[]): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const row of rows) counts.set(row.tierId, (counts.get(row.tierId) ?? 0) + 1);
  return counts;
}
