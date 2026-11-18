'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Check, Download, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { instruction } from './copy-instruction';
import { opportunityColumns } from './opportunity-columns';
import { savePlannedFixes } from './planned-fixes';
import { useOpportunityDecisions } from './use-opportunity-decisions';
import { rangeOf, nextOffset, useOffsetPaging } from '../changes/offset-paging';
import { LinksDropped } from '../links-dropped';
import { useSearchDraft } from '../pages/search-draft';
import type { LinksTabContext } from '../tabs';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableProps, RecordAction } from '@/components/app/data-table/types';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { downloadApiFile } from '@/lib/api/download';
import { isApiProblem } from '@/lib/api/problem';
import { copyText } from '@/lib/dom/clipboard';
import { formatInteger } from '@/lib/format';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import {
  CHANGE_LIMIT,
  isOpportunityPage,
  opportunitiesExportQuery,
  opportunitiesPath,
  opportunitiesQuery,
  type OpportunitiesQuery,
} from '@/lib/internal-links/queries';
import type { Opportunity, OpportunityPage, OpportunityStatus } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';
import { formatColumns, parseColumns, parseDensity } from '@/lib/tables/table-state';

const TABLE_KEYS = { density: parseAsString, cols: parseAsString };
const NO_ROWS: readonly Opportunity[] = [];
const REQUIRED_COLUMNS = ['source'];
const EXPORT_NAME = 'internal-links-opportunities.csv';
const SEARCH_DELAY_MS = 250;
const PAGE_SIZES = [100, 200] as const;
const STATUS_CHIPS: readonly (OpportunityStatus | null)[] = [null, 'open', 'accepted', 'dismissed'];
const ALL_TIERS = 'all';

/** The answer as a page of opportunities (its generated type is `unknown`, see `isOpportunityPage`). */
function readPage(data: unknown): OpportunityPage {
  if (isOpportunityPage(data)) return data;
  throw new Error('The opportunities answer is not a page of opportunities');
}

/** Where focus goes once the list has changed: the row just decided, or a status chip after a bulk decision. */
type Restore = { key: string; index: number } | { chip: OpportunityStatus | null };

/**
 * The Opportunities tab (spec 7.10, mock `il-opps.js`): pages that mention a topic of another page without linking
 * to it. Accept plans the fix, Dismiss hides it, Undo reopens it. Decisions belong to the latest crawl, so an older
 * crawl is read only. The source page's equity share is in the payload and is never read.
 */
export function OpportunitiesTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks');
  const o = useTranslations('internalLinks.opportunities');
  const common = useTranslations('common');
  const { scope, crawl, state, setSearch, tiers, registerExport } = context;
  const canWrite = useCan('projects:write');
  // Decisions are of the latest crawl (the API reads the latest crawl's list): an older one is read only
  const canDecide = canWrite && !crawl.older;
  const { draft, setDraft } = useSearchDraft(state.oppQuery, (oq) => setSearch({ oq }), SEARCH_DELAY_MS);
  const filtersKey = JSON.stringify([state.oppStatus, state.oppTier, state.oppQuery, crawl.run]);
  const paging = useOffsetPaging(filtersKey);
  const [table, setTable] = useQueryStates(TABLE_KEYS, { history: 'replace' });

  const listQuery: OpportunitiesQuery = {
    status: state.oppStatus,
    tier: state.oppTier,
    q: state.oppQuery,
    offset: paging.offset,
    limit: paging.size,
  };
  const options = opportunitiesQuery(scope, listQuery, crawl.run);
  const read = useQuery({
    ...options,
    // A crawl without its links has nothing to read (the API answers 410)
    enabled: crawl.linksAvailable,
    placeholderData: keepPreviousData,
    select: readPage,
  });
  const rows = read.data?.data ?? NO_ROWS;
  const total = read.data?.meta.total ?? null;
  const counts = read.data?.meta.counts;
  const settled = !read.isPlaceholderData;
  const { reset } = paging;
  const stale = settled && read.isSuccess && rows.length === 0 && paging.offset > 0;
  useEffect(() => {
    if (stale) reset();
  }, [stale, reset]);

  // The Export menu downloads the list as shown, every row
  const gone = isLinksDropped(read.error);
  const exportQuery = useMemo(
    () =>
      opportunitiesExportQuery(
        { status: state.oppStatus, tier: state.oppTier, q: state.oppQuery, offset: 0, limit: CHANGE_LIMIT },
        crawl.run,
      ),
    [state.oppStatus, state.oppTier, state.oppQuery, crawl.run],
  );
  useEffect(() => {
    if (!crawl.linksAvailable || gone) return undefined;
    registerExport(() => downloadApiFile(opportunitiesPath(scope), exportQuery, EXPORT_NAME));
    return () => registerExport(null);
  }, [crawl.linksAvailable, gone, registerExport, scope, exportQuery]);

  // Decisions
  const decisions = useOpportunityDecisions(scope, options.queryKey, state.oppStatus);
  const [picked, setPicked] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: filtersKey, ids: new Set() });
  const selectionKey = `${filtersKey}|${String(paging.offset)}`;
  // A choice is of one list and one page: another discards it for good
  if (picked.key !== selectionKey) setPicked({ key: selectionKey, ids: new Set() });
  const chosen = picked.key === selectionKey ? picked.ids : new Set<string>();
  const clearSelection = useCallback((): void => setPicked({ key: selectionKey, ids: new Set() }), [selectionKey]);

  // A decision that has settled asks for focus once; the list it changed is already on screen by then
  const [focusRequest, setFocusRequest] = useState<{ id: number; target: Restore } | null>(null);
  const handled = useRef(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const askFocus = useCallback(
    (target: Restore): void => setFocusRequest((before) => ({ id: (before?.id ?? 0) + 1, target })),
    [],
  );
  useEffect(() => {
    const root = wrapper.current;
    if (focusRequest === null || root === null || handled.current === focusRequest.id) return;
    handled.current = focusRequest.id;
    const { target } = focusRequest;
    if ('chip' in target) {
      root.querySelector<HTMLElement>(`[data-chip="${target.chip ?? ''}"]`)?.focus();
      return;
    }
    const buttons = [...root.querySelectorAll<HTMLElement>('[data-decision]')];
    const same = buttons.find((button) => button.dataset.decision === target.key);
    const row = rows[Math.min(target.index, rows.length - 1)];
    const next =
      same ?? (row === undefined ? undefined : buttons.find((button) => button.dataset.decision === row.key));
    (next ?? root.querySelector<HTMLElement>('input[type="search"]'))?.focus();
  }, [focusRequest, rows]);

  const { decide, pending: deciding } = decisions;
  const decideOne = useCallback(
    (row: Opportunity, status: OpportunityStatus): void => {
      const target: Restore = { key: row.key, index: rows.findIndex((candidate) => candidate.key === row.key) };
      void decide([row], status).then(() => askFocus(target));
    },
    [decide, askFocus, rows],
  );
  const decideChosen = (status: OpportunityStatus): void => {
    const targets = rows.filter((row) => chosen.has(row.key));
    void decide(targets, status).then((done) => {
      if (done) clearSelection();
      askFocus({ chip: state.oppStatus });
    });
  };
  const copyInstruction = useCallback(
    (row: Opportunity): void => {
      void copyText(instruction(row)).then((done) =>
        toast(done ? { type: 'success', title: o('copied') } : { type: 'error', title: common('copy.failed') }),
      );
    },
    [common, o],
  );

  // Planned fixes: the accepted rows, or every open row when none is accepted
  const planning = useRef(false);
  const [planningBusy, setPlanningBusy] = useState(false);
  const downloadPlanned = (): void => {
    if (planning.current) return;
    planning.current = true;
    setPlanningBusy(true);
    savePlannedFixes(scope, crawl.run)
      .then((outcome) => {
        if (outcome === 'none')
          toast({ type: 'info', title: o('nothingToExport'), description: o('nothingToExportText') });
      })
      .catch((failure: unknown) => {
        const reason = isApiProblem(failure) ? reasonOf(failure) : '';
        toast({
          type: 'error',
          title: o('plannedFailed'),
          ...(reason === '' ? {} : { description: reason }),
        });
      })
      .finally(() => {
        planning.current = false;
        setPlanningBusy(false);
      });
  };

  const columns = useMemo(
    () =>
      opportunityColumns(t, {
        canDecide,
        pending: deciding,
        onDecide: decideOne,
        onCopy: copyInstruction,
        onOpenPage: context.inspect.open,
      }),
    [t, canDecide, deciding, decideOne, copyInstruction, context.inspect.open],
  );
  const known = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);

  const tierOptions: SelectOption<string>[] = useMemo(
    () => [
      { value: ALL_TIERS, label: o('all') },
      ...tiers.map((tier) => ({ value: String(tier.position), label: tier.code })),
      { value: 'none', label: o('untiered') },
    ],
    [tiers, o],
  );

  if (!crawl.linksAvailable) return <LinksDropped />;

  const searched = state.oppQuery !== null;
  const filtered = state.oppStatus !== null || state.oppTier !== null || searched;
  const allCount = counts === undefined ? null : counts.open + counts.accepted + counts.dismissed;
  const clearFilters = (): void => {
    setDraft('');
    setSearch({ os: null, ot: null, oq: null });
  };
  const status: DataTableProps<Opportunity>['status'] =
    read.isError && read.data === undefined
      ? 'error'
      : read.isPending
        ? 'loading'
        : read.isFetching
          ? 'refetching'
          : rows.length === 0
            ? filtered
              ? 'filtered-empty'
              : 'empty'
            : 'ready';
  const range = rangeOf(paging.offset, rows.length, total ?? 0);
  const rangeText = o('range', {
    from: formatInteger(range.from),
    to: formatInteger(range.to),
    total: formatInteger(range.total),
  });
  const hasNext = settled && nextOffset(paging.offset, paging.size, total ?? 0) !== null;
  const capped = settled && rows.length > 0 && !hasNext && paging.offset + rows.length < (total ?? 0);
  const bulkActions: RecordAction<Opportunity>[] = [
    { id: 'accept', label: o('accept'), icon: Check, group: 'object', onSelect: () => decideChosen('accepted') },
    { id: 'dismiss', label: o('dismiss'), icon: X, group: 'object', onSelect: () => decideChosen('dismissed') },
  ];
  const noOpenOnly = state.oppStatus === 'open' && !searched && state.oppTier === null;

  return (
    <div ref={wrapper} className="flex min-w-0 flex-col gap-3">
      {canWrite && crawl.older ? <Banner tone="neutral" placement="region" message={o('olderNote')} /> : null}
      <div role="group" aria-label={o('statusLabel')} className="flex flex-wrap items-center gap-2">
        {STATUS_CHIPS.map((chip) => {
          const count = counts === undefined ? null : chip === null ? allCount : counts[chip];
          return (
            <Button
              key={chip ?? 'all'}
              variant="secondary"
              size="sm"
              data-chip={chip ?? ''}
              aria-pressed={state.oppStatus === chip}
              onClick={() => setSearch({ os: chip })}
            >
              {t(`opportunities.status.${chip ?? 'all'}`)}{' '}
              <span className="num type-body-strong">{count === null ? '' : formatInteger(count)}</span>
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select<string>
          size="sm"
          aria-label={o('targetTier')}
          placeholder={o('targetTier')}
          value={state.oppTier ?? ALL_TIERS}
          options={tierOptions}
          onValueChange={(value) => setSearch({ ot: value === ALL_TIERS ? null : value })}
        />
        {total === null || allCount === null ? null : (
          <span className="num type-meta text-foreground-secondary">
            {total === allCount
              ? o('count', { count: total })
              : o('countOf', { shown: formatInteger(total), total: allCount })}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={Download}
          className="ml-auto"
          title={o('plannedTip')}
          disabled={planningBusy}
          onClick={downloadPlanned}
        >
          {o('planned')}
        </Button>
      </div>
      <DataTable<Opportunity>
        caption={o('caption')}
        itemNoun={{ one: o('one'), other: o('other') }}
        columns={columns}
        getRowId={(row) => row.key}
        rows={rows}
        total={total}
        server={{
          rangeText,
          offset: paging.offset,
          hasPrevious: settled && paging.offset > 0,
          hasNext,
          onPrevious: paging.previous,
          onNext: () => paging.next(total ?? 0),
          pageSize: paging.size,
          onPageSizeChange: paging.setSize,
          pageSizes: PAGE_SIZES,
        }}
        sort={[]}
        onSortChange={() => undefined}
        defaultSort={[]}
        density={parseDensity(table.density)}
        onDensityChange={(density) => void setTable({ density: density === 'compact' ? null : density })}
        columnState={{
          visible: parseColumns(table.cols, known, REQUIRED_COLUMNS),
          onChange: (visible) => void setTable({ cols: visible === null ? null : formatColumns(visible) }),
        }}
        search={draft}
        onSearchChange={setDraft}
        searchPlaceholder={o('search')}
        rowName={(row) => t('opportunities.rowName', { from: row.source.path, to: row.target.path })}
        onRowOpen={(row) => context.inspect.open(row.source.url_id)}
        selection={
          canDecide
            ? {
                selectedIds: chosen,
                onChange: (ids) => setPicked({ key: selectionKey, ids }),
                matchingTotal: null,
                allMatching: false,
                onAllMatchingChange: () => undefined,
                selectedCount: chosen.size,
                selectedLabel: o('selected', { count: chosen.size }),
              }
            : undefined
        }
        bulkActions={canDecide ? bulkActions : undefined}
        status={status}
        errorState={
          gone ? (
            <LinksDropped />
          ) : (
            <InlineError
              title={o('loadFailed')}
              reason={isApiProblem(read.error) ? reasonOf(read.error) || o('loadFailedReason') : o('loadFailedReason')}
              errorId={null}
              onRetry={() => void read.refetch()}
              retrying={read.isFetching}
              retryLabel={common('retry')}
            />
          )
        }
        emptyState={<EmptyState title={o('emptyTitle')} reason={o('emptyText')} headingLevel={3} />}
        filteredEmptyState={
          noOpenOnly ? (
            <EmptyState
              title={o('noOpenTitle')}
              reason={o('noOpenText')}
              headingLevel={3}
              primaryAction={
                <Button variant="secondary" size="sm" onClick={() => setSearch({ os: null })}>
                  {o('showAll')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={o('noMatchTitle')}
              reason={o('noMatchText')}
              headingLevel={3}
              primaryAction={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  {o('clearFilters')}
                </Button>
              }
            />
          )
        }
      />
      {capped ? <p className="type-meta text-foreground-secondary">{o('pagingLimit')}</p> : null}
    </div>
  );
}
