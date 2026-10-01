/**
 * Keyword text as the API reads it (backend `keywords/text.py`): the text kept is the input with format
 * characters removed and whitespace trimmed and collapsed, casing kept; the normalized text that makes a
 * keyword's identity is NFKC, without format characters, lower case, whitespace collapsed, NFKC again.
 */

/** Longest keyword, counted on the cleaned text. */
export const MAX_KEYWORD_LENGTH = 700;

/** Format characters (Unicode Cf): soft hyphens, zero-width joiners and the like. */
const FORMAT = /\p{Cf}/gu;
/** Control characters other than whitespace (Cc), and lone surrogates (Cs). */
const CONTROL = /[\p{Cc}\p{Cs}]/u;
const WHITESPACE = /\s+/g;

/** The text kept: format characters removed, whitespace trimmed and collapsed, casing kept. */
export const cleanKeyword = (raw: string): string => raw.replace(FORMAT, '').replace(WHITESPACE, ' ').trim();

/** The identity of a keyword's text. */
export const normalizeKeyword = (raw: string): string =>
  raw.normalize('NFKC').replace(FORMAT, '').toLowerCase().replace(WHITESPACE, ' ').trim().normalize('NFKC');

const OPERATOR =
  /(?:^|\s)(?:after|before|cache|daterange|define|ext|filetype|inanchor|info|intext|intitle|inurl|link|related|site|source):\S/;
const ALL_IN = /(?:^|\s)allin(?:anchor|text|title|url):/;
const EXCLUSION = /\S\s+-[^\s\d]/;
const QUOTES = /["“”]/g;

/** Whether a normalized keyword holds a search operator, which the API refuses. */
export function hasSearchOperator(normalized: string): boolean {
  return (
    OPERATOR.test(normalized) ||
    ALL_IN.test(normalized) ||
    EXCLUSION.test(normalized) ||
    (normalized.match(QUOTES)?.length ?? 0) >= 2
  );
}

export type KeywordTextProblem =
  'keyword_invalid' | 'keyword_missing' | 'keyword_too_long' | 'search_operator_not_allowed';

/** What is wrong with a keyword's text, in the API's order, or `null`. */
export function keywordTextProblem(raw: string): KeywordTextProblem | null {
  if (CONTROL.test(raw.replace(WHITESPACE, ' '))) return 'keyword_invalid';
  const cleaned = cleanKeyword(raw);
  if (cleaned === '') return 'keyword_missing';
  if ([...cleaned].length > MAX_KEYWORD_LENGTH) return 'keyword_too_long';
  if (hasSearchOperator(normalizeKeyword(raw))) return 'search_operator_not_allowed';
  return null;
}

/** What the API says for each problem. */
export const KEYWORD_TEXT_MESSAGES: Readonly<Record<KeywordTextProblem, string>> = {
  keyword_invalid: 'The keyword holds a control character.',
  keyword_missing: 'Enter a keyword.',
  keyword_too_long: `A keyword is at most ${String(MAX_KEYWORD_LENGTH)} characters.`,
  search_operator_not_allowed: 'Search operators such as site: or a minus before a word are not tracked.',
};
