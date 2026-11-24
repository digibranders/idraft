'use client';

import { useMemo } from 'react';

import type { AlertScope } from './alert-queries';
import { useKeywordGroups, useVocabularies } from '@/lib/keywords/taxonomy-reads';

/** A group a rule can be narrowed to, as a list shows it. */
export interface GroupChoice {
  id: string;
  label: string;
}

export interface GroupChoices {
  /** The project's keyword groups, for the rank rules. */
  keyword: readonly GroupChoice[];
  /** The groups of prompts (the terms of the group tag sets), for the AI rules. */
  prompt: readonly GroupChoice[];
  pending: boolean;
  failed: boolean;
  retry: () => void;
}

/** The two kinds of group a rule's scope names, read from the reads the Keywords and Prompts pages share. */
export function useGroupChoices(scope: AlertScope): GroupChoices {
  const keywordGroups = useKeywordGroups(scope);
  const vocabularies = useVocabularies(scope);
  const keyword = useMemo(
    (): GroupChoice[] => (keywordGroups.data?.data ?? []).map((group) => ({ id: group.group_id, label: group.path })),
    [keywordGroups.data],
  );
  const prompt = useMemo(
    (): GroupChoice[] =>
      vocabularies.loaded
        .filter(({ vocabulary }) => vocabulary.kind === 'topic')
        .flatMap(({ terms }) => terms.map((term) => ({ id: term.termId, label: term.path }))),
    [vocabularies.loaded],
  );
  return {
    keyword,
    prompt,
    pending: keywordGroups.isPending || vocabularies.pending,
    failed: keywordGroups.isError || vocabularies.error,
    retry: () => {
      if (keywordGroups.isError) void keywordGroups.refetch();
      vocabularies.retry();
    },
  };
}
