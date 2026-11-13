'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { metaLine } from '../../header/meta-line';
import type { Branded } from '../../scope/scope-model';
import { formatDateRange } from '@/lib/format';

/** The words of the meta line, from `aiOverview.engines.common`: a card passes the translator of that namespace. */
export type MetaWords = (
  key: 'metaPrompts' | 'metaAnswers' | 'brandedExcluded' | 'brandedOnly' | 'brandedIncluded' | 'eachPromptOnce',
  values?: { count: number },
) => string;

export interface MetaInput {
  /** The window the figures are of, in project days. */
  range: { from: string; to: string };
  /** The prompts in scope; `null` when not known, which leaves the fact out and never writes 0. */
  prompts: number | null;
  /** The valid answers behind the figures; `null` as above. */
  answers: number | null;
  branded: Branded;
  /** The figures are the mean of the prompts' own rates: say that each prompt counts once. */
  promptWeighted?: boolean;
}

const BRANDED_WORDS = {
  excluded: 'brandedExcluded',
  included: 'brandedIncluded',
  only: 'brandedOnly',
} as const satisfies Record<Branded, Parameters<MetaWords>[0]>;

/**
 * The meta line of a card (`ChartFrame.meta`): "Oct 16 to Nov 12, 2026 · 250 prompts, 1,800 valid answers · branded
 * prompts left out". Three facts, so two middle dots at most (25 section 5.11); a fact that is not known is left out.
 */
export function cardMeta(
  { range, prompts, answers, branded, promptWeighted = false }: MetaInput,
  words: MetaWords,
): string {
  const sample = [
    prompts === null ? null : words('metaPrompts', { count: prompts }),
    answers === null ? null : words('metaAnswers', { count: answers }),
  ].filter((part): part is string => part !== null);
  const choice = [words(BRANDED_WORDS[branded]), promptWeighted ? words('eachPromptOnce') : null].filter(
    (part): part is string => part !== null,
  );
  // At least the window and the branded choice are known, so there is always a line
  return (
    metaLine([
      formatDateRange(range.from, range.to),
      sample.length === 0 ? null : sample.join(', '),
      choice.join(', '),
    ]) ?? ''
  );
}

/** `cardMeta` with the words of the catalog. */
export function useCardMeta(): (input: MetaInput) => string {
  const t = useTranslations('aiOverview.engines.common');
  return useCallback((input) => cardMeta(input, (key, values) => t(key, values)), [t]);
}
