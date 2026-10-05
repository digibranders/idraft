import { parseCsv } from './csv';

export type CsvHead =
  | { kind: 'ok'; headers: string[]; samples: string[][] }
  | { kind: 'not_utf8' }
  | { kind: 'empty' }
  /** The header line is longer than the bytes read: it is not a header line of a CSV worth importing. */
  | { kind: 'header_too_long' }
  /** Two headers read the same once trimmed and without case, which no mapping can tell apart. */
  | { kind: 'duplicate_headers' }
  /** A header line and nothing after it, in a file read to its end. */
  | { kind: 'no_rows' };

const SAMPLE_ROWS = 3;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** What a header is matched by: the API compares headers trimmed and without case. */
export const headerKey = (header: string): string => header.trim().toLowerCase();

/**
 * The header line and the first rows of a CSV file, read from its first `maxBytes` only, so a 50 MB file
 * costs no more than a small one. The bytes are cut at the last line break they hold (LF or CR), so neither
 * a row nor a UTF-8 character is cut in half; the whole file is read when it is smaller.
 */
export async function readCsvHead(file: Blob, maxBytes = 65_536): Promise<CsvHead> {
  const bytes = new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
  const whole = file.size <= maxBytes;
  const end = whole ? bytes.length : Math.max(bytes.lastIndexOf(LINE_FEED), bytes.lastIndexOf(CARRIAGE_RETURN)) + 1;
  // Not a single line break in the bytes read: the header line is longer than all of them
  if (!whole && end === 0) return { kind: 'header_too_long' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
  } catch {
    return { kind: 'not_utf8' };
  }
  const [header, ...rows] = parseCsv(text);
  if (header === undefined || header.every((cell) => cell.trim() === '')) return { kind: 'empty' };
  const headers = header.map((cell) => cell.trim());
  if (new Set(headers.map(headerKey)).size !== headers.length) return { kind: 'duplicate_headers' };
  // Rows may start past the bytes read when the file is longer, so only a file read whole can be without any
  if (whole && rows.length === 0) return { kind: 'no_rows' };
  return { kind: 'ok', headers, samples: rows.slice(0, SAMPLE_ROWS) };
}
