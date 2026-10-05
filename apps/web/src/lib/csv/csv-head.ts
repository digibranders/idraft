import { parseCsv } from './csv';

export type CsvHead = { kind: 'ok'; headers: string[]; samples: string[][] } | { kind: 'not_utf8' } | { kind: 'empty' };

const SAMPLE_ROWS = 3;
const NEWLINE = 0x0a;

/**
 * The header line and the first rows of a CSV file, read from its first `maxBytes` only, so a 50 MB file
 * costs no more than a small one. The bytes are cut at the last line break they hold, so neither a row nor
 * a UTF-8 character is cut in half; the whole file is read when it is smaller.
 */
export async function readCsvHead(file: Blob, maxBytes = 65_536): Promise<CsvHead> {
  const bytes = new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
  const whole = file.size <= maxBytes;
  const end = whole ? bytes.length : bytes.lastIndexOf(NEWLINE) + 1;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
  } catch {
    return { kind: 'not_utf8' };
  }
  const [header, ...rows] = parseCsv(text);
  if (header === undefined || header.every((cell) => cell.trim() === '')) return { kind: 'empty' };
  return { kind: 'ok', headers: header.map((cell) => cell.trim()), samples: rows.slice(0, SAMPLE_ROWS) };
}
