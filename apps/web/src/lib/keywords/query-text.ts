/**
 * The text of a search that goes to the API as `filter[q]` (backend `QueryText`, 19 section 2.4): 1 to 200
 * printable characters. Control, format and line or paragraph separator characters are refused (`422`), and
 * the API reads a longer text as an error, so the app sends only what it takes.
 */

/** The longest text the API takes in a search. */
export const QUERY_TEXT_MAX = 200;

/** The Unicode categories the API refuses in a search: Cc, Cf, Zl and Zp. */
const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const NOT_PRINTABLE_EVERYWHERE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Whether the text holds only characters the API takes. */
export const isPrintable = (text: string): boolean => !NOT_PRINTABLE.test(text);

/**
 * What to send for what was typed: a space in place of each character the API refuses, trimmed, and at most
 * 200 characters (a character outside the basic plane counts as one, as the API counts it). `''` when nothing
 * is left, which is sent as no search.
 */
export function queryTextOf(typed: string): string {
  const printable = typed.replace(NOT_PRINTABLE_EVERYWHERE, ' ').trim();
  return [...printable].slice(0, QUERY_TEXT_MAX).join('').trimEnd();
}
