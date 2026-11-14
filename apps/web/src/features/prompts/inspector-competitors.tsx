'use client';

import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { ALL_ENGINES, competitorCounts, type CompetitorRow } from './competitor-counts';
import type { PromptAnswers, PromptCounts } from './inspector-reads';
import { projectEntitiesQuery, type PromptScope } from './prompt-queries';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';

export interface InspectorCompetitorsProps {
  scope: PromptScope;
  counts: PromptCounts;
  /** The enabled engines, in order: the switch's choices. */
  engines: readonly ProjectEngine[];
  answers: PromptAnswers;
}

/**
 * The Competitors tab of the prompt inspector (parity spec G98): for this prompt over the window, in how many of the
 * valid answers each tracked brand is named, on one engine or on all. Counted in the browser from the list of the
 * prompt's answers; the own brand comes first and is marked. A mention is a name in an answer, not a recommendation.
 * When the list is the 200 answers the API gives at most and it has more, the tab says its counts are of the latest.
 */
export function InspectorCompetitors({ scope, counts, engines, answers }: InspectorCompetitorsProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const words = useTranslations('prompts.inspector.competitors');
  const common = useTranslations('common');
  const [chosen, setEngine] = useState<string>(ALL_ENGINES);
  const entities = useQuery(projectEntitiesQuery(scope));
  const colors = new Map((entities.data?.data ?? []).map((entry) => [entry.entity.entity_id, entry.color_index]));
  // The list keeps the answers of an engine that was turned off: they are no part of "All", and a choice of that
  // engine falls back to All
  const codes: string[] = engines.map((entry) => entry.engine.engine_code);
  const engine = codes.includes(chosen) ? chosen : ALL_ENGINES;
  const result = competitorCounts(answers.rows, counts.entities, engine, codes);

  const columns: PlainColumn<CompetitorRow>[] = [
    {
      id: 'brand',
      header: words('brand'),
      wrap: true,
      cell: (row) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <EntitySwatch own={row.own} colorIndex={colors.get(row.entityId) ?? null} />
          <span className={row.own ? 'type-body-strong' : undefined}>{row.name}</span>
          {row.own ? <Badge tone="info">{words('own')}</Badge> : null}
        </span>
      ),
    },
    {
      id: 'mentions',
      header: words('mentionedIn'),
      wrap: true,
      // The share, and under it the count it is: k of n answers
      cell: (row) => (
        <span className="flex flex-col whitespace-nowrap">
          <span className="num type-body-strong">
            {row.share === null ? EMPTY_VALUE : formatPercent(row.share, { decimals: 0 })}
          </span>
          <span className="num type-meta">{words('count', { mentions: row.mentions, answers: row.answers })}</span>
        </span>
      ),
    },
  ];

  let status: InspectorSectionStatus = 'ready';
  if (counts.status === 'failed' || answers.status === 'error') status = 'error';
  else if (counts.status === 'loading' || answers.status === 'loading') status = 'loading';

  const nothing = result.tracked === 0 || result.answers === 0 || !result.named;
  const empty =
    result.tracked === 0 ? (
      <EmptyState
        variant="inline"
        title={words('noneTrackedTitle')}
        reason={words('noneTrackedReason')}
        headingLevel={3}
      />
    ) : result.answers === 0 ? (
      <EmptyState variant="inline" title={t('answersEmpty')} reason={t('answersEmptyReason')} headingLevel={3} />
    ) : (
      <EmptyState variant="inline" title={words('emptyTitle')} reason={words('emptyReason')} headingLevel={3} />
    );
  const failed = counts.status === 'failed';

  return (
    <InspectorSection
      title={t('tabCompetitors')}
      icon={Users}
      status={status}
      action={
        engines.length > 0 ? (
          <SegmentedControl<string>
            semantics="view"
            size="sm"
            label={words('engineLabel')}
            value={engine}
            onValueChange={setEngine}
            items={[
              ...engines.map((entry) => ({ value: entry.engine.engine_code, label: entry.engine.label })),
              { value: ALL_ENGINES, label: words('all') },
            ]}
          />
        ) : undefined
      }
      error={
        <InlineError
          title={failed ? t('countsFailed') : t('answersFailed')}
          reason={t('loadFailedReason')}
          errorId={failed ? counts.errorId : answers.errorId}
          onRetry={failed ? counts.retry : answers.retry}
          retrying={failed ? counts.retrying : answers.retrying}
          retryLabel={common('retry')}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <p className="type-meta">{words('explain')}</p>
        {answers.hasMore ? <p className="type-meta">{words('basedOn', { count: answers.rows.length })}</p> : null}
        {nothing ? empty : null}
        {/* The own brand stays in view when no competitor is named; with no answer there is nothing to count */}
        {result.tracked === 0 || result.answers === 0 ? null : (
          <PlainTable<CompetitorRow>
            caption={words('caption')}
            columns={columns}
            rows={result.named ? result.rows : result.rows.filter((row) => row.own)}
            rowKey={(row) => row.entityId}
            status="ready"
            errorState={null}
            emptyText={t('answersEmpty')}
          />
        )}
      </div>
    </InspectorSection>
  );
}
