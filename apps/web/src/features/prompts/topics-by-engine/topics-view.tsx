'use client';

import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useCallback, useEffect, type ReactElement } from 'react';

import { parseView, type TopicsView as View } from './drill';
import { useByEngineColumns } from './engine-columns';
import { MetricSelect } from './metric-select';
import { useTopicEntities, type TopicReadScope } from './topic-entities-query';
import { useDrill } from './use-drill';
import { ViewSwitch } from './view-switch';
import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';
import { setTopicOrder } from '@/features/prompts/topic-drawer/topic-order-store';
import { parseMetric } from '@/features/prompts/prompt-model';
import { TopicsTable, type TopicRow, type TopicsTableProps } from '@/features/prompts/topics-table';
import type { EngineSummary } from '@/lib/api/types';

/** The view the Topics tab opens on when the address names none. Flipping the default is this one constant. */
export const DEFAULT_TOPICS_VIEW: View = 'list';

const cellsOf = (row: TopicRow): readonly EngineSummary[] => (row.kind === 'more' ? [] : row.engines);
/** A topic's key and name; a prompt row and the row that offers the rest of a topic's prompts are no topic. */
const topicOf = (row: TopicRow): { key: string; name: string } | null =>
  row.kind === 'topic' ? { key: row.key, name: row.name } : null;

export type TopicsViewProps = TopicsTableProps & TopicReadScope;

/**
 * The Topics tab (WP-20): the List, the table as it was, and the By engine view, the same table with a rate column per
 * engine for the chosen metric, the engine gap and, in the column chooser, counts, trends and leaders. The view is the
 * address's `view`, the metric its `metric`. The entities (who leads each engine) are read only while By engine is on.
 */
export function TopicsView({ scope, range, includeBranded, country, ...table }: TopicsViewProps): ReactElement {
  const t = useTranslations('prompts.topicDrawer.byEngineView');
  const common = useTranslations('common');
  const [viewText, setViewText] = useQueryState('view', parseAsString);
  const [metricText, setMetricText] = useQueryState('metric', parseAsString);
  // Until the Heat map is built `?view=heatmap` reads as the List
  const requested = viewText === null ? DEFAULT_TOPICS_VIEW : parseView(viewText);
  const view: View = requested === 'engines' ? 'engines' : 'list';
  const metric = parseMetric(metricText);
  const entities = useTopicEntities({ scope, range, includeBranded, country }, view === 'engines');
  const onDrill = useDrill();
  const columns = useByEngineColumns<TopicRow>({ engines: table.engines, cellsOf, topicOf, entities, metric, onDrill });
  const { projectId } = scope;
  const onTopicOrderChange = useCallback((keys: readonly string[]) => setTopicOrder(projectId, keys), [projectId]);
  // The order the drawer steps through is this table's: it goes with it
  useEffect(() => () => setTopicOrder(projectId, null), [projectId]);
  const switcher = (
    <ViewSwitch value={view} onValueChange={(next) => void setViewText(next === DEFAULT_TOPICS_VIEW ? null : next)} />
  );

  if (view === 'list') {
    return (
      <TopicsTable
        key="list"
        {...table}
        viewSwitch={
          <>
            {switcher}
            {table.viewSwitch}
          </>
        }
        onTopicOrderChange={onTopicOrderChange}
      />
    );
  }
  return (
    <>
      {entities.status === 'failed' ? (
        <Banner
          tone="warning"
          placement="region"
          live
          message={t('entitiesFailed')}
          actions={
            <Button variant="secondary" size="sm" onClick={entities.retry} loading={entities.fetching}>
              {common('retry')}
            </Button>
          }
        />
      ) : null}
      <TopicsTable
        // A new key: the column chooser starts again from the defaults of this view
        key="engines"
        {...table}
        status={table.status === 'ready' && entities.fetching ? 'refetching' : table.status}
        viewColumns={columns}
        viewSwitch={
          <>
            {/* The two controls of this view may wrap on a phone, where the toolbar's end has little room */}
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <MetricSelect
                value={metric}
                onValueChange={(next) => void setMetricText(next === 'mention' ? null : next)}
              />
              {switcher}
            </div>
            {table.viewSwitch}
          </>
        }
        onTopicOrderChange={onTopicOrderChange}
      />
    </>
  );
}
