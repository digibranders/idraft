/** The longest alias the API stores (19 section 3.4). */
export const MAX_ALIAS_LENGTH = 200;

/** The most other names a new project's own brand takes (`own_entity.aliases`). */
export const MAX_OWN_ALIASES = 50;

/**
 * Curly quotes, primes, hyphens and dashes, by code point, as their ASCII forms (backend `_PUNCTUATION`).
 * Code points, so the source holds none of these characters.
 */
const PUNCTUATION: ReadonlyMap<number, string> = new Map([
  ...[0x2018, 0x2019, 0x201a, 0x201b, 0x2032].map((code) => [code, "'"] as const),
  ...[0x201c, 0x201d, 0x201e, 0x201f, 0x2033].map((code) => [code, '"'] as const),
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map((code) => [code, '-'] as const),
]);
/** The blocks of combining marks on Latin, Greek and Cyrillic letters; other scripts' marks tell letters apart. */
const ACCENT_BLOCKS: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];
const isAccent = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return ACCENT_BLOCKS.some(([from, to]) => code >= from && code <= to);
};
/** Symbols and other numbers separate words, as spaces do: `Acme(TM)` is `acme`, not `acmetm`. */
const SEPARATOR = /^[\s\p{So}\p{No}]$/u;
const FORMAT = /^\p{Cf}$/u;

/** One character as the matcher folds it (backend `_normalized`). */
function foldChar(char: string): string {
  if (FORMAT.test(char)) return '';
  if (SEPARATOR.test(char)) return ' ';
  // Full case folding, near enough: `ß` becomes `ss` and a final sigma a plain one
  const ascii = PUNCTUATION.get(char.codePointAt(0) ?? 0) ?? char;
  const decomposed = ascii.normalize('NFKD').toUpperCase().toLowerCase();
  return [...decomposed].map((piece) => (/^\s$/u.test(piece) ? ' ' : isAccent(piece) ? '' : piece)).join('');
}

/**
 * Text as the matcher compares it (backend `extraction/text.py`, `normalize(..., fold_case=True)`, then
 * trimmed): each character on its own, format characters gone, spaces, symbols and other numbers as one
 * space, ASCII quotes and dashes, compatibility forms, no accents on Latin, Greek and Cyrillic letters,
 * without case. Two names that fold alike are the same name to the matcher.
 */
export function foldName(text: string): string {
  return [...text].map(foldChar).join('').replace(/ {2,}/gu, ' ').trim();
}

/**
 * The other names to store for an entity, as word aliases: each once whatever its case, and not its own
 * name, which the matcher already finds by itself (doc 13 stage 4, `match_method: 'alias_name'`).
 */
export function otherNames(name: string, others: readonly string[]): string[] {
  const seen = new Set<string>([name.trim().toLocaleLowerCase()]);
  return others
    .map((alias) => alias.trim())
    .filter((alias) => {
      const key = alias.toLocaleLowerCase();
      if (alias === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
