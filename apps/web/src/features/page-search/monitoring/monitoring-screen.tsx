'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CircleMinus, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { AddPagesDialog } from './add-pages-dialog';
import { MonitoringFilters, useCountedFields, useMonitoringFields } from './monitoring-filters';
import { MonitoringInspector } from './monitoring-inspector';
import { useMonitoringColumns } from './monitoring-columns';
import { csvOf, showCannibalization, visibleRows, type CsvWords } from './monitoring-rows';
import { NoAccess, NotConnectedState, NothingTracked, PendingBanner } from './monitoring-states';
import { DEFAULT_SORT, useMonitoringState } from './use-monitoring-state';
import { StaleBanner } from '../panel/panel-states';
import { PeriodControls } from '../panel/period-controls';
import { PAGE_SEARCH_ENTRY_KEYS, usePanelState } from '../panel/use-panel-state';
import { HEALTH_KEYS } from '../panel/verdict';
import { periodParams, periodValue } from '../period';
import { trackedPagesQuery, useUntrackPages } from '../queries';
import type { PeriodParams, TrackedPageRow } from '../types';
import { DataTable } from '@/components/app/data-table/data-table';
import type { RecordAction } from '@/components/app/data-table/types';
import { readRangeParams } from '@/components/app/date-range/range-model';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { PageToolbar } from '@/components/app/page-toolbar';
import { PAGE_CLASS } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';
import { enumValuesOf } from '@/lib/filters/filter-values';
import { formatBusinessDate } from '@/lib/format';
import { useInspectorStepping } from '@/lib/inspector/use-inspector-stepping';
import { pageTiersQuery } from '@/lib/internal-links/queries';
import { useCan } from '@/lib/permissions';

/** While any row loads its history, or Search Console loads the first days, the list is asked again at this pace. */
const POLL_MS = 10_000;
const NO_ROWS: readonly TrackedPageRow[] = [];
/** The context line holds a tooltip, so the keyboard reaches it (20 section 6.2 rule 6). */
const TAB_STOP = { tabIndex: 0 } as const;
const MAX_PERIOD_DAYS = 92;

export interface MonitoringProject {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  /** The project's website; `null` when none is set. */
  host: string | null;
}

export interface MonitoringScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: MonitoringProject;
  /** The tab strip of Pages (Overview, All pages, Monitoring), from the Pages session; nothing until it exists. */
  tabs?: ReactNode;
  /** Open a page somewhere else (the Pages drawer shell on its Search tab). Left out: the shared inspector here. */
  onOpenPage?: ((urlId: string) => void) | undefined;
}

/**
 * Pages > Monitoring (spec 10.1): the tracked pages as a table first. Two rows sit above it (the page toolbar, then the
 * period and the filters); a state banner is the one thing that may add a third. A row opens the page's search detail
 * in the shared inspector, or in the Pages drawer when the route passes `onOpenPage`.
 */
export function MonitoringScreen(props: MonitoringScreenProps): ReactNode {
  const t = useTranslations('monitoring');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageToolbar title={t('title')} />
        <NoAccess />
      </div>
    );
  }
  return <MonitoringContent {...props} />;
}

function MonitoringContent({
  workspaceId,
  workspaceSlug,
  project,
  tabs,
  onOpenPage,
}: MonitoringScreenProps): ReactElement {
  const t = useTranslations('monitoring');
  const p = useTranslations('pageSearch');
  const common = useTranslations('common');
  const scope = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const canWrite = useCan('projects:write');
  const canAdd = canWrite;
  const [adding, setAdding] = useState(false);
  const period = usePanelState();

  // With a period in the address the read with no dates only tells the last final day, so the comparison does not matter
  const defaults: PeriodParams = { compare: period.hasPeriod ? 'none' : period.compare };
  const probe = useQuery(trackedPagesQuery(scope, defaults));
  const finalThrough = probe.data?.data === undefined ? null : probe.data.meta.final_through;
  const range =
    period.hasPeriod && finalThrough !== null
      ? (() => {
          const { value, dropped } = readRangeParams(period.address, { today: finalThrough, maxDays: MAX_PERIOD_DAYS });
          return dropped === null ? value : null;
        })()
      : null;
  const params: PeriodParams =
    range === null || finalThrough === null
      ? { compare: period.compare }
      : periodParams(range, period.compare, finalThrough);
  const waiting = period.hasPeriod && probe.data === undefined;
  const read = useQuery({
    ...trackedPagesQuery(scope, params),
    enabled: !waiting,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const answer = query.state.data;
      return answer !== undefined &&
        (answer.meta.state === 'pending' || answer.data.some((row) => row.history === 'loading'))
        ? POLL_MS
        : false;
    },
  });
  const answer = waiting ? undefined : read.data;
  const rows = answer?.data ?? NO_ROWS;
  const meta = answer?.meta ?? null;
  const state = meta?.state ?? null;
  const tiers = useQuery(pageTiersQuery(workspaceId)).data?.data ?? null;

  const columns = useMonitoringColumns({
    tiers,
    days:
      meta?.window == null
        ? null
        : { current: meta.window.days, before: meta.compare_window?.days ?? meta.window.days },
    pending: state === 'pending',
    // The app has no Cannibalization route yet; the badge is plain text until it has (spec 11)
    cannibalizationHref: null,
    showCannibalization: showCannibalization(rows),
  });
  const known = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const table = useMonitoringState(known);

  const fields = useMonitoringFields(tiers, rows, answer === undefined);
  const [values, setValues] = useUrlFilters(fields);
  const tier = enumValuesOf(values.tier)[0] ?? '';
  const health = enumValuesOf(values.health)[0] ?? '';
  const shownFields = useCountedFields(fields, rows, { tier, search: table.search });
  const filtered = useMemo(
    () => visibleRows(rows, { tier, health, search: table.search }),
    [rows, tier, health, table.search],
  );

  // Opening, stepping and closing the inspector
  const inspector = useInspector({ entryKeys: PAGE_SEARCH_ENTRY_KEYS });
  const inspectedId = inspector.target?.type === 'page' ? inspector.target.id : null;
  const [order, setOrder] = useState<readonly string[]>([]);
  const inspectorWords = useTranslations('monitoring.inspector');
  const stepping = useInspectorStepping({
    inspector,
    type: 'page',
    order,
    typeLabel: inspectorWords('typeLabel'),
    typeNoun: inspectorWords('typeNoun'),
  });
  const openRow = (row: TrackedPageRow, intent: 'inspector' | 'new-tab'): void => {
    if (intent === 'new-tab') {
      const next = new URLSearchParams(window.location.search);
      next.set('inspect', `page:${row.url_id}`);
      window.open(`${window.location.pathname}?${next.toString()}`, '_blank', 'noopener');
    } else if (onOpenPage !== undefined) onOpenPage(row.url_id);
    else inspector.open({ type: 'page', id: row.url_id });
  };
  const inspected = inspectedId === null ? null : (rows.find((row) => row.url_id === inspectedId) ?? null);
  // A page that is not tracked any more has no detail to show here
  const settled = answer !== undefined && !read.isPlaceholderData;
  const { close } = inspector;
  useEffect(() => {
    if (inspectedId !== null && settled && inspected === null) close();
  }, [inspectedId, settled, inspected, close]);

  // Stop tracking and Export
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const untrack = useUntrackPages(scope);
  const stopTracking = (ids: readonly string[]): void => {
    untrack.mutate([...ids], {
      onSuccess: ({ removed }) => {
        setSelected(new Set());
        if (inspectedId !== null && ids.includes(inspectedId)) close();
        toast({ type: 'success', title: t('removed', { count: removed }), description: t('removedDetail') });
      },
      onError: () => toast({ type: 'error', title: t('removeFailed') }),
    });
  };
  const csvWords = useMemo(
    (): CsvWords => ({
      headers: {
        page: t('columns.page'),
        tier: t('columns.tier'),
        health: t('columns.health'),
        clicks: p('metrics.clicks'),
        clicksBefore: t('csv.clicksBefore'),
        impressions: p('metrics.impressions'),
        impressionsBefore: t('csv.impressionsBefore'),
        ctr: p('metrics.ctr'),
        ctrBefore: t('csv.ctrBefore'),
        position: p('metrics.position'),
        positionBefore: t('csv.positionBefore'),
        queries: t('columns.queries'),
        queriesBefore: t('csv.queriesBefore'),
        cannibalizationKeywords: t('csv.cannibalizationKeywords'),
        likely: t('csv.likely'),
        coRanking: t('csv.coRanking'),
        unstable: t('csv.unstable'),
      },
      tier: (tierId) => (tierId === null ? t('untiered') : (tiers?.find((one) => one.tier_id === tierId)?.code ?? '')),
      health: (verdict) => p(`health.${HEALTH_KEYS[verdict]}`),
    }),
    [t, p, tiers],
  );
  const exportRows = useCallback(
    (list: readonly TrackedPageRow[]): void => {
      downloadBlob(csvBlob(csvOf(list, csvWords)), t('csv.fileName'));
    },
    [csvWords, t],
  );
  // The file lists the rows in the order the table shows them
  const shownInOrder = useMemo(() => {
    const byId = new Map(filtered.map((row) => [row.url_id, row]));
    const ordered = order.flatMap((id) => byId.get(id) ?? []);
    return ordered.length === filtered.length ? ordered : filtered;
  }, [filtered, order]);

  const bulkActions: RecordAction<TrackedPageRow>[] = [
    {
      id: 'stop-tracking',
      label: t('bulk.stopTracking'),
      icon: CircleMinus,
      group: 'destructive',
      onSelect: (_rows, actionScope) => stopTracking([...actionScope.ids]),
    },
    {
      id: 'export-selection',
      label: t('bulk.exportSelection'),
      icon: Download,
      group: 'object',
      onSelect: (selectedRows) => exportRows(selectedRows),
    },
  ];

  const date = finalThrough === null ? null : formatBusinessDate(finalThrough);
  const context =
    date === null || meta === null ? undefined : (
      <Tooltip content={t('contextTip', { host: project.host ?? project.name, property: meta.property ?? '', date })}>
        <span {...TAB_STOP} className="type-meta text-foreground-secondary outline-none focus-visible:focus-ring">
          {t('context', { date })}
        </span>
      </Tooltip>
    );
  const banner =
    state === 'pending' ? (
      <PendingBanner />
    ) : state === 'reauth_required' || state === 'no_access' ? (
      <StaleBanner
        state={state}
        finalThrough={meta?.final_through ?? null}
        workspaceSlug={workspaceSlug}
        projectSlug={project.slug}
      />
    ) : null;
  const periodControls =
    finalThrough === null ? null : (
      <PeriodControls
        value={periodValue(range, finalThrough)}
        onValueChange={period.setPeriod}
        compare={period.compare}
        onCompareChange={period.setCompare}
        finalThrough={finalThrough}
        timeZone={project.timeZone}
      />
    );

  const status =
    read.isError && answer === undefined
      ? 'error'
      : answer === undefined
        ? 'loading'
        : rows.length === 0
          ? 'empty'
          : filtered.length === 0
            ? 'filtered-empty'
            : read.isFetching
              ? 'refetching'
              : 'ready';
  const clearFilters = (): void => {
    setValues({});
    table.setSearch('');
  };

  const inspectorHost =
    onOpenPage === undefined && inspected !== null ? (
      <MonitoringInspector
        key={inspected.url_id}
        row={inspected}
        workspaceId={workspaceId}
        projectId={project.id}
        workspaceSlug={workspaceSlug}
        projectSlug={project.slug}
        timeZone={project.timeZone}
        positionText={stepping.positionText}
        navigation={stepping.navigation}
        onStep={stepping.onStep}
        onClose={close}
      />
    ) : null;

  return (
    <InspectorLayout inspector={inspectorHost}>
      <div className={PAGE_CLASS}>
        <PageToolbar
          title={t('title')}
          tabs={tabs}
          filters={
            state === 'not_connected' ? undefined : (
              <MonitoringFilters
                periodControls={periodControls}
                fields={shownFields}
                values={values}
                onChange={setValues}
              />
            )
          }
          status={context}
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={shownInOrder.length === 0}
                onClick={() => exportRows(shownInOrder)}
              >
                {t('export')}
              </Button>
              {canAdd ? (
                <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                  {t('addPages')}
                </Button>
              ) : null}
            </>
          }
        />
        {banner}
        {state === 'not_connected' ? (
          <NotConnectedState workspaceSlug={workspaceSlug} projectSlug={project.slug} />
        ) : (
          <>
            <DataTable<TrackedPageRow>
              caption={t('caption')}
              itemNoun={{ one: t('one'), other: t('other') }}
              columns={columns}
              getRowId={(row) => row.url_id}
              rows={filtered}
              total={filtered.length}
              sort={table.sort}
              onSortChange={table.setSort}
              defaultSort={DEFAULT_SORT}
              density={table.density}
              onDensityChange={table.setDensity}
              columnState={{ visible: table.visible ?? null, onChange: table.setVisible }}
              search={table.search}
              onSearchChange={table.setSearch}
              searchPlaceholder={t('searchPlaceholder')}
              rowName={(row) => row.path}
              onRowOpen={openRow}
              onRowOrderChange={setOrder}
              activeRowId={inspectedId}
              selection={
                canWrite
                  ? {
                      selectedIds: selected,
                      onChange: setSelected,
                      matchingTotal: null,
                      allMatching: false,
                      onAllMatchingChange: () => undefined,
                    }
                  : undefined
              }
              bulkActions={canWrite ? bulkActions : undefined}
              status={status}
              errorState={
                <InlineError
                  title={t('loadFailed')}
                  reason={t('loadFailedReason')}
                  errorId={null}
                  onRetry={() => void read.refetch()}
                  retrying={read.isFetching}
                  retryLabel={common('retry')}
                />
              }
              emptyState={
                <NothingTracked limit={meta?.limit ?? 0} onAdd={canAdd ? () => setAdding(true) : undefined} />
              }
              filteredEmptyState={
                <EmptyState
                  variant="table"
                  title={t('noMatch')}
                  reason={t('noMatchReason')}
                  headingLevel={3}
                  primaryAction={
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      {t('clearFilters')}
                    </Button>
                  }
                />
              }
            />
          </>
        )}
      </div>
      {canAdd ? (
        <AddPagesDialog
          scope={scope}
          host={project.host}
          open={adding}
          onOpenChange={setAdding}
          onAdded={() => undefined}
        />
      ) : null}
    </InspectorLayout>
  );
}
