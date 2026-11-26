/**
 * The checks the note box makes on files before it sends them (spec 9.8.4). They are a courtesy that saves a round trip:
 * the server reads the bytes and decides again, and its answer is the one that counts.
 */

/** The same limits as `FILES_MAX` and `NOTE_FILE_MAX_BYTES` of the API. */
export const NOTE_FILES_MAX = 5;
export const NOTE_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type FileRefusal = { kind: 'count' } | { kind: 'type'; name: string } | { kind: 'size'; name: string };

const TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]);
/** What a browser reports when it does not know the file (a CSV is often `application/vnd.ms-excel`). */
const UNKNOWN_TYPES: ReadonlySet<string> = new Set(['', 'application/octet-stream', 'application/vnd.ms-excel']);
const EXTENSIONS: ReadonlySet<string> = new Set(['.csv', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);

function typeAllowed(file: File): boolean {
  const type = file.type.toLowerCase();
  if (TYPES.has(type)) return true;
  if (!UNKNOWN_TYPES.has(type)) return false;
  const dot = file.name.lastIndexOf('.');
  return dot > 0 && EXTENSIONS.has(file.name.slice(dot).toLowerCase());
}

/**
 * Which of `incoming` the box takes, given `have` files already in it. A file is refused for its type, then its size;
 * once the box holds 5 the rest are refused with one `count` refusal. Refusals come in the order the files did.
 */
export function checkNewFiles(have: number, incoming: readonly File[]): { accepted: File[]; refused: FileRefusal[] } {
  const accepted: File[] = [];
  const refused: FileRefusal[] = [];
  let full = false;
  for (const file of incoming) {
    if (!typeAllowed(file)) {
      refused.push({ kind: 'type', name: file.name });
    } else if (file.size > NOTE_FILE_MAX_BYTES) {
      refused.push({ kind: 'size', name: file.name });
    } else if ((Number.isFinite(have) ? Math.max(have, 0) : 0) + accepted.length >= NOTE_FILES_MAX) {
      if (!full) refused.push({ kind: 'count' });
      full = true;
    } else {
      accepted.push(file);
    }
  }
  return { accepted, refused };
}
