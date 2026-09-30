/** English only in V1 (20 section 3.11). The catalog exists so a second language is a file, not a rewrite. */
export const LOCALE = 'en';

/**
 * next-intl formats nothing here: numbers and dates go through @/lib/format, in the project's time zone.
 * The zone is still fixed, so the rendered HTML does not depend on where the image was built.
 */
export const TIME_ZONE = 'UTC';
