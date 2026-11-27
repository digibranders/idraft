'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { idKey, isCategoryId, type IssueCheck } from '@/lib/issues/types';

export interface CheckWords {
  /** The name of a check in the words of the page. */
  nameOf: (check: IssueCheck) => string;
  /** The name of a category; the id of one the web has no words for (a later slice may add one). */
  categoryOf: (category: string) => string;
}

/** The names of checks and categories, looked up by id in `messages/en.json`. */
export function useCheckWords(): CheckWords {
  const t = useTranslations('issues');
  return useMemo(
    () => ({
      nameOf: (check) => t(`checks.${idKey(check.id)}.name`),
      categoryOf: (category) => (isCategoryId(category) ? t(`categories.${idKey(category)}`) : category),
    }),
    [t],
  );
}
