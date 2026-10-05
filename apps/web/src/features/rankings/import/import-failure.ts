'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { FAILURE_KEYS, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS, isFailureCode } from './import-model';
import { formatInteger } from '@/lib/format';

/**
 * Why an import failed, in words: the message of the API's failure code, with the limit it names where there
 * is one. A code the app has no words for (or none at all) reads as `fallback`, never as the API's own English.
 */
export function useFailureText(): (code: string | null | undefined, fallback: string) => string {
  const t = useTranslations('rankings.import');
  return useCallback(
    (code, fallback) => {
      if (!isFailureCode(code)) return fallback;
      const limit = code === 'too_many_columns' ? MAX_IMPORT_COLUMNS : MAX_IMPORT_ROWS;
      return t(`failures.${FAILURE_KEYS[code]}`, { limit: formatInteger(limit) });
    },
    [t],
  );
}
