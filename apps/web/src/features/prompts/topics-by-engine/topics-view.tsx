'use client';

import { Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useCallback, useEffect, type ReactElement, type ReactNode } from 'react';

import { buildByEngineExport, byEngineFileName } from './by-engine-export';
import { parseView, type TopicsView as View } from './drill';
import { useByEngineColumns } from './engine-columns';
import { heatOrder, heatOrderText, parseHeatOrder, type HeatOrder } from './heat-model';
import { MetricSelect } from './metric-select';
import { TopicHeatmap } from './topic-heatmap';
import { topicHeads, type TopicHead } from './topic-rows';
import { useTopicEntities, type TopicReadScope } from './topic-entities-query';
import { TopicsMobileList } from './topics-mobile-list';
import { useDrill } from './use-drill';
import { ViewSwitch } from './view-switch';
import { Banner } from '@/components/app/status/banner';
import { LIST_MEDIA } from '@/components/app/data-table/data-table-list';
import type { TableStatus } from '@/components/app/data-table/types';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { setTopicOrder } from '@/features/prompts/topic-drawer/topic-order-store';
import { CELL_OF_METRIC, parseMetric, TOPIC_TAB } from '@/features/prompts/prompt-model';
import { TopicsTable, type TopicRow, type TopicsTableProps } from '@/features/prompts/topics-table';
import type { EngineSummary } from '@/lib/api/types';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';
import { useMediaQuery } from '@/lib/dom/use-media-query';

/** The view the Topics tab opens on when the address names none. Flipping the default is this one constant. */
export const DEFAULT_TOPICS_VIEW: View = 'list';

const cellsOf = (row: TopicRow): readonly EngineSummary[] => (row.kind === 'more' ? [] : row.engines);
/** A topic's key and name; a prompt row and the row that offers the rest of a topic's prompts are no topic. */
const topicOf = (row: TopicRow): { key: string; name: string } | null =>
  row.kind === 'topic' ? { key: row.key, name: row.name } : null;

/** The views a phone offers: the List and the By engine view are one list there. */
const PHONE_VIEWS: readonly View[] = ['list', 'heatmap'];
/** From this width the Topics tab is a table; the list layout (`LIST_MEDIA`) is the complement. */
const TABLE_MEDIA = '(width >= 48rem)';

/**
 * Whether the phone list stands in for the table. Asking for both sides of the breakpoint keeps the first render on the
 * table (the server and hydration answer false to the narrow query) and keeps a harness that answers true to every
 * query (the test stub of a wide window) on the table too.
 */
function usePhoneLayout(): boolean {
  const narrow = useMediaQuery(LIST_MEDIA);
  const wide = useMediaQuery(TABLE_MEDIA);
  return narrow && !wide;
}

export type TopicsViewProps = TopicsTableProps & TopicReadScope;

/**
 * The Topics tab (WP-20): the List, the table as it was; the By engine view, the same table with a rate column per
 * engine for the chosen metric, the engine gap and, in the column chooser, counts, trends and leaders, and an export;
 * and the Heat map, a row per topic against the engines. The view is the address's `view`, the metric its `metric`.
 * The entities (who leads each engine) are read only while By engine is on. Under 768 px the List and the By engine view
 * are one list of two line rows, and the Heat map stays a grid that scrolls.
 */
export function TopicsView({ scope, range, includeBranded, country, ...table }: TopicsViewProps): ReactElement {
  const t = useTranslations('prompts.topicDrawer.byEngineView');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const locale = useLocale();
  const phone = usePhoneLayout();
  const [viewText, setViewText] = useQueryState('view', parseAsString);
  const [metricText, setMetricText] = useQueryState('metric', parseAsString);
  const view: View = viewText === null ? DEFAULT_TOPICS_VIEW : parseView(viewText);
  const metric = parseMetric(metricText);
  const metricKey = CELL_OF_METRIC[metric];
  // The phone has no By engine table: its list is the List
  const columnsView = view === 'engines' && !phone;
  const entities = useTopicEntities({ scope, range, includeBranded, country }, columnsView);
  const onDrill = useDrill();
  const columns = useByEngineColumns<TopicRow>({ engines: table.engines, cellsOf, topicOf, entities, metric, onDrill });
  const { projectId } = scope;
  const onTopicOrderChange = useCallback((keys: readonly string[]) => setTopicOrder(projectId, keys), [projectId]);
  // The order the drawer steps through is this table's: it goes with it
  useEffect(() => () => setTopicOrder(projectId, null), [projectId]);

  const { summary, tree, descendants, kept, filtering, countryChosen, search, engines } = table;
  const codes = engines.map((entry) => entry.engine.engine_code);
  const noTopicName = prompts('columns.noTopic');
  /** The topic tree as plain heads: for the heat map (which a search does not narrow), the phone list and the export. */
  const headsFor = (searched: string | null): TopicHead[] =>
    topicHeads({ summary, tree, descendants, kept, filtering, search: searched, locale, noTopicName });
  const onHeatmap = view === 'heatmap';
  const heads = onHeatmap ? headsFor(null) : phone ? headsFor(search) : [];
  /** Empty or filtered empty once the rows are in and there are none, as the table says it. */
  const statusOf = (searched: boolean): TableStatus => {
    const settled = table.status === 'ready' || table.status === 'refetching';
    if (!settled || heads.length > 0) return table.status;
    return !searched && !filtering && !countryChosen ? 'empty' : 'filtered-empty';
  };

  const switcher = (
    <ViewSwitch
      value={phone && view === 'engines' ? 'list' : view}
      onValueChange={(next) => void setViewText(next === DEFAULT_TOPICS_VIEW ? null : next)}
      views={phone ? PHONE_VIEWS : undefined}
    />
  );
  const metricSelect = (
    <MetricSelect value={metric} onValueChange={(next) => void setMetricText(next === 'mention' ? null : next)} />
  );

  const exportByEngine = (): void => {
    // The topics in the order of the API, the most prompts first; the search and the topic filter narrow the file as they
    // narrow the table, so it holds what the person is looking at
    const exported = heatOrder(headsFor(search), 'prompts', metricKey, codes);
    const count = exported.reduce((sum, head) => sum + 1 + head.children.length, 0);
    if (count === 0) {
      toast({ type: 'error', title: t('exportNone') });
      return;
    }
    try {
      const metricLabel = prompts(`metric.${metric}`);
      const file = buildByEngineExport(exported, engines, metric, {
        topic: t('exportTopic'),
        parent: t('exportParent'),
        prompts: t('exportPrompts'),
        rate: (engine) => t('exportRate', { engine, metric: metricLabel }),
        counted: (engine) => t('exportCounted', { engine }),
        answers: (engine) => t('exportAnswers', { engine }),
        change: (engine) => t('exportChange', { engine }),
        gap: t('exportGap'),
        best: t('exportBest'),
        engines: t('exportEngines'),
      });
      downloadBlob(csvBlob(file), byEngineFileName(metric, range));
      toast({ type: 'success', title: t('exported', { count }) });
    } catch {
      toast({ type: 'error', title: prompts('bulk.exportFailed') });
    }
  };

  const switches: ReactNode = (
    <>
      {switcher}
      {table.viewSwitch}
    </>
  );

  if (onHeatmap) {
    const order: HeatOrder = parseHeatOrder(table.sortText);
    return (
      <TopicHeatmap
        heads={heads}
        engines={engines}
        metric={metric}
        order={order}
        onOrderChange={(next) => table.onSortTextChange(heatOrderText(next))}
        density={table.density}
        status={statusOf(false)}
        searchIgnored={search.trim() !== ''}
        toolbarStart={metricSelect}
        toolbarEnd={switches}
        errorState={table.errorState}
        emptyState={table.emptyState}
        filteredEmptyState={table.filteredEmptyState}
        onTopicOrderChange={onTopicOrderChange}
      />
    );
  }
  if (phone) {
    return (
      <TopicsMobileList
        heads={heads}
        engines={engines}
        status={statusOf(search.trim() !== '')}
        search={search}
        onSearchChange={table.onSearchChange}
        activeTopicKey={table.activeTopicKey}
        onOpenTopic={(key) => table.onOpenTopic(key, TOPIC_TAB.overview, 'inspector')}
        onTopicOrderChange={onTopicOrderChange}
        toolbarEnd={switches}
        errorState={table.errorState}
        emptyState={table.emptyState}
        filteredEmptyState={table.filteredEmptyState}
      />
    );
  }
  if (view === 'list') {
    return <TopicsTable key="list" {...table} viewSwitch={switches} onTopicOrderChange={onTopicOrderChange} />;
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
            {/* The controls of this view may wrap on a phone, where the toolbar's end has little room */}
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {metricSelect}
              {/* Off until the topics are read, and when they could not be: there is nothing yet to write */}
              <Button
                variant="ghost"
                size="sm"
                icon={Download}
                disabled={table.status === 'loading' || table.status === 'error'}
                onClick={exportByEngine}
              >
                {/* Icon only on a phone, where the end of the toolbar also holds the switch and two icons */}
                <span className="sr-only sm:not-sr-only">{t('exportButton')}</span>
              </Button>
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
