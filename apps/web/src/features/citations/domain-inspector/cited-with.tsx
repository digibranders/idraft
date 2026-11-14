'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { SampleCount } from '@/components/app/metric/sample-count';
import { EmptyState } from '@/components/app/status/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { entitiesQuery } from '@/lib/citations/entities-query';
import type { SourceDomainDetailData, SourceScope } from '@/lib/citations/types';

export interface CitedWithSectionProps {
  source: SourceScope;
  /** `null` while the read has nothing. */
  data: SourceDomainDetailData | null;
  /** The answers that cite the domain, which each count is of; `null` when the API does not give one total. */
  answers: number | null;
}

/** The API gives five at most (sources contract); the card holds the limit itself. */
const MAX_NAMED = 5;

/** A tooltip on an element nothing focuses reaches no keyboard user (20 section 6.2 rule 6); the lint rule cannot see why. */
const FOCUSABLE = { tabIndex: 0 } as const;

/**
 * "Named when cited" (WB-DOM-05): the tracked entities the answers that cite the domain name most, at most five, each
 * with the answers that name it out of the answers that cite the domain. A name comes from the project's entities,
 * as the Domains table's "Cited with" does: an entity that is not among them (or an entities read that failed) says
 * n/a with the reason, never a blank, and keeps its count. A domain whose answers name none says so in words.
 */
export function CitedWithSection({ source, data, answers }: CitedWithSectionProps): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const entities = useQuery({ ...entitiesQuery(source), placeholderData: keepPreviousData });
  const names = useMemo(
    () => new Map((entities.data?.data ?? []).map(({ entity }) => [entity.entity_id, entity.canonical_name])),
    [entities.data],
  );
  // Most named first, whatever order the read came in
  const named = useMemo(
    () => [...(data?.cited_with ?? [])].sort((a, b) => b.observations - a.observations).slice(0, MAX_NAMED),
    [data],
  );
  // Names that are not loaded yet are not names that are not known: the card waits for the read's answer or failure
  const status = data === null || entities.isPending ? 'loading' : named.length === 0 ? 'empty' : 'ready';

  return (
    <InspectorSection
      title={t('coTitle')}
      icon={Users}
      status={status}
      empty={<EmptyState variant="inline" title={t('coNone')} reason={t('coNoneReason')} headingLevel={3} />}
    >
      <p className="mb-2 type-meta">{t('coLead')}</p>
      <ul className="flex flex-col gap-2">
        {named.map((entry) => {
          const name = names.get(entry.entity_id);
          return (
            <li key={entry.entity_id} className="flex items-baseline justify-between gap-3">
              {name === undefined ? (
                <Tooltip content={t('coNameTip')}>
                  <span
                    {...FOCUSABLE}
                    className="rounded-sm type-body text-foreground-tertiary outline-none focus-visible:focus-ring"
                  >
                    {t('coNameUnknown')}
                  </span>
                </Tooltip>
              ) : (
                <span className="min-w-0 type-body wrap-anywhere">{name}</span>
              )}
              {answers === null ? (
                <span className="shrink-0 type-meta">{t('coCell', { count: entry.observations })}</span>
              ) : (
                <span className="shrink-0">
                  <SampleCount k={entry.observations} n={answers} noun="answers" />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </InspectorSection>
  );
}
