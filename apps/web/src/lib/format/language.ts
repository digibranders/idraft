/**
 * The languages a project can default to, as ISO 639-1 codes: the markets the product's clients track most.
 * The API takes any code; this list is what the forms offer until a languages endpoint exists.
 */
export const LANGUAGE_CODES = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'pt',
  'sv',
  'da',
  'no',
  'fi',
  'pl',
  'cs',
  'tr',
  'ru',
  'ar',
  'hi',
  'ja',
  'ko',
  'zh',
] as const;

const DEFAULT_LOCALE = 'en-US';
const names = new Map<string, Intl.DisplayNames>();

/** The name of a language in the reader's language: "German" for `de`. The code itself when unknown. */
export function languageName(code: string, locale: string = DEFAULT_LOCALE): string {
  let display = names.get(locale);
  if (display === undefined) {
    display = new Intl.DisplayNames([locale], { type: 'language' });
    names.set(locale, display);
  }
  try {
    return display.of(code) ?? code;
  } catch (error) {
    if (error instanceof RangeError) return code;
    throw error;
  }
}
