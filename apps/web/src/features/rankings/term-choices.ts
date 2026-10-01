'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import type { ProjectScope } from './rankings-queries';
import { useVocabularies } from './taxonomy-queries';

/** A term as a choice of a tag field: "Topics: SEO / Local SEO". */
export interface TermChoice {
  id: string;
  label: string;
  vocabularyId: string;
  /** Its vocabulary takes one term per keyword. */
  single: boolean;
}

export interface TermChoices {
  choices: readonly TermChoice[];
  byId: ReadonlyMap<string, TermChoice>;
  /** The chosen ids with each single-valued vocabulary down to its term chosen last. */
  keepOnePerSingleVocabulary: (ids: readonly string[]) => string[];
  /** The vocabularies or their terms are still loading. */
  pending: boolean;
}

/**
 * Every term of the vocabularies the project sees, as the tag fields of Add keywords and the bulk tag
 * dialog offer them. A keyword holds one term of a single-valued vocabulary, so a field keeps the one
 * chosen last (the API would refuse two with `single_valued_vocabulary`).
 */
export function useTermChoices(scope: ProjectScope): TermChoices {
  const t = useTranslations('rankings.add');
  const vocabularies = useVocabularies(scope);
  const choices = useMemo(
    (): TermChoice[] =>
      vocabularies.loaded.flatMap(({ vocabulary, terms }) =>
        terms.map((term) => ({
          id: term.termId,
          label: t('tagLabel', { vocabulary: vocabulary.name, term: term.path }),
          vocabularyId: vocabulary.vocabulary_id,
          single: vocabulary.is_single_valued,
        })),
      ),
    [t, vocabularies.loaded],
  );
  const byId = useMemo(() => new Map(choices.map((choice) => [choice.id, choice])), [choices]);
  const keepOnePerSingleVocabulary = useCallback(
    (ids: readonly string[]): string[] => {
      const kept: string[] = [];
      for (const id of [...ids].reverse()) {
        const term = byId.get(id);
        const taken =
          term?.single === true && kept.some((other) => byId.get(other)?.vocabularyId === term.vocabularyId);
        if (!taken) kept.unshift(id);
      }
      return kept;
    },
    [byId],
  );
  return { choices, byId, keepOnePerSingleVocabulary, pending: vocabularies.pending };
}
