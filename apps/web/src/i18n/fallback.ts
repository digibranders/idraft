import messages from '../../messages/en.json';

import { LOCALE, TIME_ZONE } from './locale';

/**
 * The catalog for `global-error.tsx`, which replaces the root layout when the layout itself fails and so
 * has no next-intl provider from it. It gives that page its own.
 */
export const FALLBACK_INTL = { locale: LOCALE, messages, timeZone: TIME_ZONE } as const;
