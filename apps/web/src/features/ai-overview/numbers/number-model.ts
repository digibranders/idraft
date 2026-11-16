/**
 * The one thing of the retired numbers strip that other cards still use: the type of the translator they put into
 * words (`useTranslations(namespace) as Say`). The cards of the sources and competitors families import it from here,
 * so it stays until they take it from a shared home; nothing else of the strip is left.
 */
export type Say = (key: string, values?: Record<string, string | number>) => string;
