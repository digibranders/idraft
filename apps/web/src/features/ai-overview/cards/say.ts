/**
 * The type of the translator the cards of the sources, competitors and headline families put into words
 * (`useTranslations(namespace) as Say`): their number words are looked up by key.
 */
export type Say = (key: string, values?: Record<string, string | number>) => string;
