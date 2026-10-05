'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { reasonKeyOf } from './run-status';

/**
 * The words for a run's `status_reason`, from the `runReasons` namespace; `null` for a reason this client has
 * no words for, which the caller may show as the API sent it or leave out.
 */
export function useRunReason(): (reason: string | null | undefined) => string | null {
  const t = useTranslations('runReasons');
  return useCallback(
    (reason) => {
      const key = reasonKeyOf(reason);
      return key === null ? null : t(key);
    },
    [t],
  );
}
