'use client';

import { Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useCallback, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';

import { buildByEngineExport, byEngineFileName } from './by-engine-export';
import { parseView, type TopicsView as View } from './drill';
import { useByEngineColumns } from './engine-columns';
import { heatOrder, heatOrderText, parseHeatOrder, type HeatOrder } from './heat-model';
import { TopicHeatmap } from './topic-heatmap';
import { topicHeads, type TopicHead } from './topic-rows';
import { useTopicEntities, type TopicReadScope } from './topic-entities-query';
import { TopicsMobileList } from './topics-mobile-list';
import { useDrill } from './use-drill';
import { ViewSwitch } from './view-switch';
import { LIST_MEDIA } from '@/components/app/data-table/data-table-list';
import type { DataTableColumn, TableStatus } from '@/components/app/data-table/types';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { setTopicOrder } from '@/features/prompts/topic-drawer/topic-order-store';
import { CELL_OF_METRIC, engineSortId, TOPIC_TAB, type RateMetric } from '@/features/prompts/prompt-model';
import { TopicsTable, type TopicRow, type TopicsTableProps } from '@/features/prompts/topics-table';
import type { EngineSummary } from '@/lib/api/types';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';
import { useMediaQuery } from '@/lib/dom/use-media-query';

/** The view the Groups tab opens on when the address names none. Flipping the default is this one constant. */
export const DEFAULT_TOPICS_VIEW: View = 'list';

/** The Groups views show the mention rate only: the preview has no metric choice (commit 2413d3a9). */
const METRIC: RateMetric = 'mention';

const cellsOf = (row: TopicRow): readonly EngineSummary[] => row.engines;
/** A group's key and name; a prompt row is no group. */
const topicOf = (row: TopicRow): { key: string; name: string } | null =>
  row.kind === 'topic' ? { key: row.key, name: row.name } : null;

/** The views a phone offers: the List and the By platform view are one list there. */
const PHONE_VIEWS: readonly View[] = ['list', 'heatmap'];
/** From this width the Groups tab is a table; the list layout (`LIST_MEDIA`) is the complement. */
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

export type TopicsViewProps = Omit<TopicsTableProps, 'project'> & TopicReadScope;

/**
 * The Groups tab (WP-20, PR-TVIEW): the List, the table of groups that open onto their prompts; the By platform view,
 * the same table with the mention rate of each platform and the platform gap, and an export; and the Heat map, a row
 * per group against the platforms. The view is the address's `view`; changing it puts the sort back on the Mention rate,
 * since a column of one view is not a column of another. Under 768 px the List and the By platform view are one list
 * of two line rows, and the Heat map stays a grid that scrolls.
 */
export function TopicsView({ scope, range, includeBranded, country, ...table }: TopicsViewProps): ReactElement {
  const t = useTranslations('prompts.topicDrawer.byEngineView');
  const prompts = useTranslations('prompts');
  const locale = useLocale();
  const phone = usePhoneLayout();
  const [viewText, setViewText] = useQueryState('view', parseAsString);
  const view: View = viewText === null ? DEFAULT_TOPICS_VIEW : parseView(viewText);
  const metricKey = CELL_OF_METRIC[METRIC];
  // The phone has no By platform table: its list is the List
  const columnsView = view === 'engines' && !phone;
  // Not asked: the leaders of a platform are not in the By platform view of the preview
  const entities = useTopicEntities({ scope, range, includeBranded, country }, false);
  const onDrill = useDrill();
  const allColumns = useByEngineColumns<TopicRow>({
    engines: table.engines,
    cellsOf,
    topicOf,
    entities,
    metric: METRIC,
    onDrill,
  });
  // The columns of the preview's By platform view: each platform's mention rate and the platform gap
  const columns = useMemo((): DataTableColumn<TopicRow>[] => {
    const shown = new Set([
      ...table.engines.map(({ engine }) => engineSortId(engine.engine_code, 'rate')),
      'engine_gap',
    ]);
    return allColumns.filter((column) => shown.has(column.id));
  }, [allColumns, table.engines]);
  const { projectId } = scope;
  const onTopicOrderChange = useCallback((keys: readonly string[]) => setTopicOrder(projectId, keys), [projectId]);
  // The order the drawer steps through is this table's: it goes with it
  useEffect(() => () => setTopicOrder(projectId, null), [projectId]);

  const { summary, tree, descendants, kept, filtering, search, engines } = table;
  const codes = engines.map((entry) => entry.engine.engine_code);
  /** The groups as plain heads: for the heat map, the phone list and the export. The search narrows them as the table's. */
  const headsFor = (searched: string | null): TopicHead[] =>
    topicHeads({ summary, tree, descendants, kept, filtering, search: searched, locale });
  const onHeatmap = view === 'heatmap';
  const heads = onHeatmap || phone ? headsFor(search) : [];
  /** Empty or filtered empty once the rows are in and there are none, as the table says it. */
  const statusOf = (searched: boolean): TableStatus => {
    const settled = table.status === 'ready' || table.status === 'refetching';
    if (!settled || heads.length > 0) return table.status;
    return !searched && !filtering && !table.countryChosen ? 'empty' : 'filtered-empty';
  };

  const switcher = (
    <ViewSwitch
      value={phone && view === 'engines' ? 'list' : view}
      onValueChange={(next) => {
        void setViewText(next === DEFAULT_TOPICS_VIEW ? null : next);
        table.onSortTextChange(null);
      }}
      views={phone ? PHONE_VIEWS : undefined}
    />
  );

  const exportByEngine = (): void => {
    // The groups in the order of the API, the most prompts first; the search and the group filter narrow the file as they
    // narrow the table, so it holds what the person is looking at
    const exported = heatOrder(headsFor(search), 'prompts', metricKey, codes);
    if (exported.length === 0) {
      toast({ type: 'error', title: t('exportNone') });
      return;
    }
    try {
      const metricLabel = prompts(`metric.${METRIC}`);
      const file = buildByEngineExport(exported, engines, METRIC, {
        topic: t('exportTopic'),
        prompts: t('exportPrompts'),
        rate: (engine) => t('exportRate', { engine, metric: metricLabel }),
        counted: (engine) => t('exportCounted', { engine }),
        answers: (engine) => t('exportAnswers', { engine }),
        change: (engine) => t('exportChange', { engine }),
        gap: t('exportGap'),
        best: t('exportBest'),
        engines: t('exportEngines'),
      });
      downloadBlob(csvBlob(file), byEngineFileName(METRIC, range));
      toast({ type: 'success', title: t('exported', { count: exported.length }) });
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
        metric={METRIC}
        order={order}
        onOrderChange={(next) => table.onSortTextChange(heatOrderText(next))}
        density="compact"
        status={statusOf(search.trim() !== '')}
        search={search}
        onSearchChange={table.onSearchChange}
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
  if (!columnsView) {
    return (
      <TopicsTable
        key="list"
        {...table}
        project={scope}
        viewSwitch={switches}
        onTopicOrderChange={onTopicOrderChange}
      />
    );
  }
  return (
    <TopicsTable
      // A new key: the column chooser starts again from the defaults of this view
      key="engines"
      {...table}
      project={scope}
      viewColumns={columns}
      viewSwitch={
        <>
          {/* The controls of this view may wrap on a phone, where the toolbar's end has little room */}
          <div className="flex min-w-0 flex-wrap items-center gap-1">
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
  );
}
