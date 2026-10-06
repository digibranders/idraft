'use client';

import { useTranslations } from 'next-intl';

import { isApiProblem } from './problem';

/** The error id of a failed request with the words an `InlineError` shows beside it. */
export interface ErrorIdWords {
  id: string;
  /** "Error ID {id}", already filled in. */
  label: string;
  copyLabel: string;
  copiedLabel: string;
}

/**
 * The id support looks a failed request up by (17-empty-loading-error-states.md section 5.2): the request id
 * of the API's problem, in the one set of words every region uses, or `null` for an error that has none (a
 * lost connection, a proxy's answer).
 */
export function useErrorId(error: unknown): ErrorIdWords | null {
  const t = useTranslations('status.error');
  if (!isApiProblem(error) || error.requestId === null) return null;
  const id = error.requestId;
  return { id, label: t('errorId', { id }), copyLabel: t('copyErrorId'), copiedLabel: t('copied') };
}
