import { fetchApiBlob } from '@/lib/api/download';
import { downloadBlob } from '@/lib/csv/csv-write';
import { opportunitiesPath, plannedExportQuery } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';

export const PLANNED_FILE = 'internal-links-planned-fixes.csv';
const BYTE_ORDER_MARK = 0xfeff;

/** Whether a CSV holds a row after its header line (the header alone means nothing to export). */
export function csvHasRows(text: string): boolean {
  const body = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  const lineEnd = body.search(/\r?\n/);
  return lineEnd >= 0 && body.slice(lineEnd).trim() !== '';
}

/** Saves the planned fixes CSV of the crawl in view; `none` when it has no row and nothing was saved. */
export async function savePlannedFixes(scope: LinksScope, run: string | null): Promise<'saved' | 'none'> {
  const blob = await fetchApiBlob(opportunitiesPath(scope), plannedExportQuery(run));
  if (!csvHasRows(await blob.text())) return 'none';
  downloadBlob(blob, PLANNED_FILE);
  return 'saved';
}
