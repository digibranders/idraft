import type { useTranslations } from 'next-intl';

import type { CitationTab } from './citation-scope';
import type { FilterField, FilterOption } from '@/components/app/filters/types';
import type { DomainRole, EngineCode } from '@/lib/citations/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The fields of the Citations filter bar (WB-CIT-04, DS 9.7), in one function so the Domain and the New and lost
 * tabs add theirs here. The ids are the URL keys `parseScope` reads. The date range and the comparison are scope,
 * not filters, so they are no field.
 */

/** The translator of `citations.filters`, as `useTranslations('citations.filters')` and `createTranslator` give it. */
export type FilterTranslate = ReturnType<typeof useTranslations<'citations.filters'>>;

/** The translator of `citations.flagFilters`, as `useTranslations('citations.flagFilters')` and `createTranslator` give it. */
export type FlagTranslate = ReturnType<typeof useTranslations<'citations.flagFilters'>>;

export interface CitationFilterInput {
  t: FilterTranslate;
  /** The words of the two flag toggles; without them the bar offers neither (a harness that does not need them). */
  flagWords?: FlagTranslate | undefined;
  tab: CitationTab;
  /** The engines that are on, in the project's order. */
  engines: readonly { code: EngineCode; label: string }[];
  /** The engines have not been read (or the read failed): a link's engine is kept until they are. */
  enginesLoading: boolean;
  /** Citation units of each role in the whole scope (`meta.by_role`); `null` while unknown. */
  roleUnits: Readonly<Record<DomainRole, number>> | null;
  /** Every term of the topic vocabularies, depth first. */
  topics: readonly NamedTerm[];
  topicsLoading: boolean;
}

const ROLES: readonly DomainRole[] = ['own', 'competitor', 'third_party'];

function topicOptions(topics: readonly NamedTerm[]): FilterOption[] {
  const nameCounts = new Map<string, number>();
  for (const term of topics) nameCounts.set(term.name, (nameCounts.get(term.name) ?? 0) + 1);
  // Two topics of one name under different parents are told apart by where they sit
  return topics.map((term) => ({
    value: term.termId,
    label: (nameCounts.get(term.name) ?? 0) > 1 ? term.path : term.name,
  }));
}

export function citationFilterFields({
  t,
  flagWords,
  tab,
  engines,
  enginesLoading,
  roleUnits,
  topics,
  topicsLoading,
}: CitationFilterInput): FilterField[] {
  const roleLabel: Record<DomainRole, string> = {
    own: t('roles.own'),
    competitor: t('roles.competitor'),
    third_party: t('roles.thirdParty'),
  };
  const fields: FilterField[] = [
    {
      id: 'engine',
      kind: 'enum',
      label: t('engine'),
      multi: true,
      optionsLoading: enginesLoading,
      options: engines.map((engine) => ({ value: engine.code, label: engine.label })),
    },
    {
      id: 'role',
      kind: 'enum',
      label: t('role'),
      multi: true,
      options: ROLES.map((role) => ({ value: role, label: roleLabel[role], count: roleUnits?.[role] ?? null })),
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
  if (tab === 'pages') fields.push({ id: 'domain', kind: 'text', label: t('domain'), operators: ['equals'] });
  // Both are off unless chosen: the flagged citations stay out of every share and unit (owner decision O1)
  if (flagWords !== undefined) {
    fields.push(
      {
        id: 'redirects',
        kind: 'enum',
        label: flagWords('redirects'),
        multi: false,
        options: [{ value: 'include', label: flagWords('redirectsInclude') }],
      },
      {
        id: 'internal',
        kind: 'enum',
        label: flagWords('internal'),
        multi: false,
        options: [{ value: 'include', label: flagWords('internalInclude') }],
      },
    );
  }
  return fields;
}
