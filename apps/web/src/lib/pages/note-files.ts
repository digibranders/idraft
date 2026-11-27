/**
 * The checks the note box makes on files before it sends them (spec 9.8.4). They go by the file's name and the type the
 * browser reports, never by its content: they are a courtesy that saves a round trip. The server reads the bytes and
 * decides by content, and its answer is the one that counts.
 */

/** The same limits as `FILES_MAX` and `NOTE_FILE_MAX_BYTES` of the API. */
export const NOTE_FILES_MAX = 5;
export const NOTE_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type FileRefusal =
  | { kind: 'count' }
  | { kind: 'type'; name: string }
  | { kind: 'size'; name: string }
  | { kind: 'empty'; name: string }
  | { kind: 'duplicate'; name: string };

function sameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

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
 * Which of `incoming` the box takes, given `have` files already in it (`existing` are those files, when the caller has
 * them, so a file added twice is caught). A file is refused for its type, then as empty, then its size, then as a
 * duplicate (same name, size and date); once the box holds 5 the rest are refused with one `count` refusal. Refusals
 * come in the order the files did.
 */
export function checkNewFiles(
  have: number,
  incoming: readonly File[],
  existing: readonly File[] = [],
): { accepted: File[]; refused: FileRefusal[] } {
  const accepted: File[] = [];
  const refused: FileRefusal[] = [];
  let full = false;
  for (const file of incoming) {
    if (!typeAllowed(file)) {
      refused.push({ kind: 'type', name: file.name });
    } else if (file.size === 0) {
      refused.push({ kind: 'empty', name: file.name });
    } else if (file.size > NOTE_FILE_MAX_BYTES) {
      refused.push({ kind: 'size', name: file.name });
    } else if ([...existing, ...accepted].some((held) => sameFile(held, file))) {
      refused.push({ kind: 'duplicate', name: file.name });
    } else if ((Number.isFinite(have) ? Math.max(have, 0) : 0) + accepted.length >= NOTE_FILES_MAX) {
      if (!full) refused.push({ kind: 'count' });
      full = true;
    } else {
      accepted.push(file);
    }
  }
  return { accepted, refused };
}
