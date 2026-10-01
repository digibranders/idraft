const DEFAULT_LOCALE = 'en-US';

/** Names joined as a sentence lists them: ["A", "B", "C"] -> "A, B, and C". */
export function formatList(items: readonly string[], locale: string = DEFAULT_LOCALE): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
}
