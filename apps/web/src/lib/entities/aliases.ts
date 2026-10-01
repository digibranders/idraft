/** The longest alias the API stores (19 section 3.4). */
export const MAX_ALIAS_LENGTH = 200;

/** The most other names a new project's own brand takes (`own_entity.aliases`). */
export const MAX_OWN_ALIASES = 50;

/** Curly quotes and primes, and the hyphen and dash characters, as the matcher writes them. */
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032]/gu;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/gu;
const DASHES = /[\u2010-\u2015\u2212]/gu;
/** The blocks of combining marks on Latin, Greek and Cyrillic letters; other scripts' marks tell letters apart. */
const ACCENT_BLOCKS: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];
const isAccent = (mark: string): boolean => {
  const code = mark.codePointAt(0) ?? 0;
  return ACCENT_BLOCKS.some(([from, to]) => code >= from && code <= to);
};
const FORMAT = /\p{Cf}/gu;

/**
 * Text as the matcher compares it (backend `extraction/text.py`, `normalize(..., fold_case=True)`):
 * compatibility forms, no accents on Latin, Greek and Cyrillic letters, ASCII quotes and dashes, no
 * format characters, one space for a run of spaces, without case, trimmed. Two names that fold alike are
 * the same name to the matcher.
 */
export function foldName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, (mark) => (isAccent(mark) ? '' : mark))
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(FORMAT, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase()
    .trim();
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
