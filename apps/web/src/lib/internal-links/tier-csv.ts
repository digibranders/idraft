import { parseCsv } from '@/lib/csv/csv';

/** The API reads at most this many rows (its CSV body is at most 1 MB; plan 02 `too_many_rows`). */
export const MAX_CSV_ROWS = 20_000;

export interface CsvTier {
  tier_id: string;
  code: string;
  name: string;
}

export interface CsvTierRow {
  line: number;
  url: string;
  tierId: string;
}

export interface CsvTierError {
  line: number;
  code: 'unknown_tier' | 'missing_column' | 'too_many_rows';
  /** The tier text that did not match; empty for the other codes. */
  value: string;
}

const isHeader = (cells: readonly string[]): boolean =>
  cells[0]?.trim().toLowerCase() === 'url' && cells[1]?.trim().toLowerCase() === 'tier';

/**
 * The Check step of the CSV import (spec 5.2, decision W14): one page per line, `url` then `tier` (a code such as
 * T1 or a name such as Money pages, any letter case), an optional header line, blank lines skipped. Line numbers
 * are the lines of the text, so the errors point where the person typed. Whether a URL is in the crawl is the
 * API's answer (`pending`), not this check's.
 */
export function parseTierCsv(text: string, tiers: readonly CsvTier[]): { rows: CsvTierRow[]; errors: CsvTierError[] } {
  const byName = new Map<string, string>();
  for (const tier of tiers) {
    byName.set(tier.code.toLowerCase(), tier.tier_id);
    byName.set(tier.name.trim().toLowerCase(), tier.tier_id);
  }
  const rows: CsvTierRow[] = [];
  const errors: CsvTierError[] = [];
  const lines = text.split(/\r?\n/);
  let counted = 0;
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const cells = parseCsv(raw)[0];
    if (cells === undefined) continue;
    if (line === 1 && isHeader(cells)) continue;
    counted += 1;
    if (counted > MAX_CSV_ROWS) {
      errors.push({ line, code: 'too_many_rows', value: '' });
      break;
    }
    const url = cells[0]?.trim() ?? '';
    const tierText = cells[1]?.trim() ?? '';
    if (url === '' || tierText === '') {
      errors.push({ line, code: 'missing_column', value: '' });
      continue;
    }
    const tierId = byName.get(tierText.toLowerCase());
    if (tierId === undefined) errors.push({ line, code: 'unknown_tier', value: tierText });
    else rows.push({ line, url, tierId });
  }
  return { rows, errors };
}
