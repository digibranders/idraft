import type { useTranslations } from 'next-intl';

import type { FilterField, FilterOption } from '@/components/app/filters/types';
import type { EngineCode } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The fields of the Competitors filter bar (WB-CMP-01): the ids are the URL keys `parseScope` reads. The date range,
 * the country and the comparison are scope, not filters, so they are no field.
 */

/** The translator of `competitors.filters`, as `useTranslations('competitors.filters')` and `createTranslator` give it. */
export type FilterTranslate = ReturnType<typeof useTranslations<'competitors.filters'>>;

export interface CompetitorFilterInput {
  t: FilterTranslate;
  /** The engines that are on, in the project's order. */
  engines: readonly { code: EngineCode; label: string }[];
  /** The engines have not been read (or the read failed): a link's engine is kept until they are. */
  enginesLoading: boolean;
  /** Every term of the topic vocabularies, depth first. */
  topics: readonly NamedTerm[];
  topicsLoading: boolean;
}

function topicOptions(topics: readonly NamedTerm[]): FilterOption[] {
  const nameCounts = new Map<string, number>();
  for (const term of topics) nameCounts.set(term.name, (nameCounts.get(term.name) ?? 0) + 1);
  // Two topics of one name under different parents are told apart by where they sit
  return topics.map((term) => ({
    value: term.termId,
    label: (nameCounts.get(term.name) ?? 0) > 1 ? term.path : term.name,
  }));
}

export function competitorFilterFields({
  t,
  engines,
  enginesLoading,
  topics,
  topicsLoading,
}: CompetitorFilterInput): FilterField[] {
  return [
    {
      id: 'engine',
      kind: 'enum',
      label: t('engine'),
      multi: true,
      optionsLoading: enginesLoading,
      options: engines.map((engine) => ({ value: engine.code, label: engine.label })),
    },
    {
      id: 'topic',
      kind: 'enum',
      label: t('topic'),
      multi: false,
      optionsLoading: topicsLoading,
      options: topicOptions(topics),
    },
    {
      id: 'branded',
      kind: 'enum',
      label: t('branded'),
      multi: false,
      options: [{ value: 'include', label: t('brandedInclude') }],
    },
  ];
}
