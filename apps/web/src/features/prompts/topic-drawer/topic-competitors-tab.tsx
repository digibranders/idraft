'use client';

import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';

import { useTopicDrawer } from './drawer-context';
import { entityTable, type EntityMetric, type EntityTableCell, type EntityTableRow } from './entity-table-model';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Truncate } from '@/components/ui/truncate';
import { useRateWords } from '@/features/prompts/rate-view';
import type { TopicInspectorTab } from '@/features/prompts/seams/topic-tabs';
import { useTopicEntities } from '@/features/prompts/topics-by-engine/topic-entities-query';
import { useErrorId } from '@/lib/api/use-error-id';
import { formatPercent } from '@/lib/format';

/**
 * The Competitors tab of the topic drawer (WB-TPE-13): for this topic over the window, how each tracked entity does on
 * each engine, the own brand first. The value is Mentioned or Share of voice (the leader rule's metric, so the default),
 * with the answers behind it; the competitor that leads an engine by it is in the heavier weight and named for screen
 * readers. The entities and their cells come from the topic rows read with `include=entities`, the read the By engine view
 * makes too. It is a table on purpose: a later package (WP-23) adds the swatch and the bars to these rows.
 */
export function CompetitorsTab(): ReactElement {
  const { topicKey, engines, extras } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer.competitors');
  const panel = useTranslations('prompts.topicDrawer.panel');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const words = useRateWords();
  const { scope, range, includeBranded, country } = extras;
  const read = useMemo(() => ({ scope, range, includeBranded, country }), [scope, range, includeBranded, country]);
  const entities = useTopicEntities(read, true);
  const errorId = useErrorId(entities.error);
  const [metric, setMetric] = useState<EntityMetric>('share_of_voice');

  const shown = useMemo(
    () => engines.map(({ engine }) => ({ code: engine.engine_code, label: engine.label })),
    [engines],
  );
  const rows = useMemo(
    () =>
      entityTable(
        entities.rows.get(topicKey),
        entities.tracked,
        shown.map((entry) => entry.code),
        metric,
      ),
    [entities.rows, entities.tracked, topicKey, shown, metric],
  );

  const cellOf = (cell: EntityTableCell, label: string): ReactElement => {
    const figure = cell.figure;
    if (figure === null || figure.state === 'none') return <span>{panel('noAnswers')}</span>;
    if (figure.state === 'insufficient') return <span>{words.inline(figure)}</span>;
    const text = t('cell', {
      value: formatPercent(figure.value, { decimals: 0 }),
      basis: words.basis(figure) ?? '',
    });
    return cell.leads ? (
      <span className="inline-flex flex-col">
        <span className="type-body-strong">{text}</span>
        <span className="sr-only">{t('leads', { engine: label })}</span>
      </span>
    ) : (
      <span>{text}</span>
    );
  };
  const columns: PlainColumn<EntityTableRow>[] = [
    {
      id: 'entity',
      header: t('entity'),
      cell: (row) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Truncate text={row.name} className={row.role === 'own' ? 'type-body-strong' : undefined} />
          {row.role === 'own' ? <Badge tone="info">{t('own')}</Badge> : null}
        </span>
      ),
    },
    ...shown.map(({ code, label }): PlainColumn<EntityTableRow> => ({
      id: code,
      header: label,
      cell: (row) => {
        const cell = row.cells.find((candidate) => candidate.engineCode === code);
        return cell === undefined ? <span>{panel('noAnswers')}</span> : cellOf(cell, label);
      },
    })),
  ];

  const nobody = entities.status === 'ready' && !entities.tracked.some((entity) => entity.role === 'competitor');
  const status: InspectorSectionStatus =
    entities.status === 'loading' ? 'loading' : entities.status === 'failed' ? 'error' : nobody ? 'empty' : 'ready';

  return (
    <InspectorSection
      title={t('title')}
      icon={Users}
      status={status}
      action={
        status === 'ready' ? (
          <SegmentedControl<EntityMetric>
            semantics="view"
            size="sm"
            label={t('metricLabel')}
            value={metric}
            onValueChange={setMetric}
            items={[
              { value: 'share_of_voice', label: t('metricShare') },
              { value: 'mentioned', label: t('metricMentioned') },
            ]}
          />
        ) : undefined
      }
      error={
        <InlineError
          title={t('failedTitle')}
          reason={prompts('loadFailedReason')}
          errorId={errorId}
          onRetry={entities.retry}
          retrying={entities.fetching}
          retryLabel={common('retry')}
        />
      }
      empty={<EmptyState variant="inline" title={t('emptyTitle')} reason={t('emptyReason')} headingLevel={3} />}
    >
      <div className="flex flex-col gap-3">
        <PlainTable<EntityTableRow>
          caption={t('title')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.entityId}
          status="ready"
          errorState={null}
          emptyText={t('emptyTitle')}
        />
        <p className="type-meta text-foreground-tertiary">{t('footnote')}</p>
      </div>
    </InspectorSection>
  );
}

/**
 * The tab entry of the topic drawer (the seam `seams/topic-tabs.ts`), after Prompts: offered while the summary loads,
 * and when it lists a tracked competitor, as a topic of a project that tracks none has nothing to compare.
 */
export const topicCompetitorsTab: TopicInspectorTab = {
  id: 'competitors',
  label: (t) => t('prompts.topicDrawer.tabCompetitors'),
  after: 'prompts',
  available: ({ summary }) => summary === undefined || summary.entities.some((entity) => entity.role === 'competitor'),
  render: () => <CompetitorsTab />,
};
