'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import {
  changeRowId,
  daysIn,
  lostDays,
  lostWindowDays,
  noPreviousAnswers,
  previousDays,
  rowsOf,
  totalOf,
  truncatedOf,
} from './change-model';
import { useChangeColumns } from './change-columns';
import { ChangeEmpty, ChangeFailed, CountFailed } from './new-lost-states';
import { useChangeList } from '../citation-reads';
import { DEFAULT_MIN_SUPPORT, type ChangeKind } from '../citation-scope';
import { CitationFilteredEmptyState } from '../citation-table-states';
import type { CitationTabContext } from '../citation-tabs';
import { useRegisterExport } from '../export-button';
import { MinSupportSelect } from '../min-support-select';
import { ChangeList, useCitationListLayout } from '../mobile-rows';
import { DataTable } from '@/components/app/data-table/data-table';
import { ListTableSwitch } from '@/components/app/data-table/data-table-list';
import type { TableStatus } from '@/components/app/data-table/types';
import { MetricInfo } from '@/components/app/metric/metric-info';
import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import type { SourceChangePage, SourceChangeRow } from '@/lib/citations/types';
import { EMPTY_VALUE, formatDateRange, formatInteger } from '@/lib/format';
import { DEFAULT_DENSITY, formatColumns, parseColumns, type Density, type SortKey } from '@/lib/tables/table-state';

const NO_SORT: readonly SortKey[] = [];
const nothing = (): void => undefined;
const rowName = (row: SourceChangeRow): string => row.registrable_domain;

/** Whether a row is the project's own: its tint, besides the Own badge that says so in words. */
const ownRow = (row: SourceChangeRow): 'own' | undefined => (row.domain_role === 'own' ? 'own' : undefined);

export interface NewLostTabProps {
  context: CitationTabContext;
}

/**
 * The New and lost tab (DS 9.7, WB-CIT-13, docs/16 C5 and C6): the domains that started to be cited and those that
 * stopped, one list at a time. The strip already reads both kinds, so this tab asks for the same two requests and
 * adds none (plan D2, D3). Counts only: a domain that has just started has no earlier share to compare. The rule is
 * in the info button, and the Lost list says how many days of answers it read.
 */
export function NewLostTab({ context }: NewLostTabProps): ReactElement {
  const { source, timeZone, scope, filters, range, enabledEngines, setSearch, filterBar } = context;
  const t = useTranslations('citations.newLost');
  const tt = useTranslations('citations.table');
  const common = useTranslations('common');
  const locale = useLocale();
  const kind = scope.changeKind;
  const otherKind: ChangeKind = kind === 'new' ? 'lost' : 'new';
  // The tab asks nothing while another one is shown, or before the engines are known: with none listed the scope
  // drops the link's `engine`, and the read would be of every engine
  const active = scope.tab === 'new-lost' && enabledEngines.length > 0;
  // Both kinds are read, so each segment has its count: the strip asks for the same two requests
  const newRead = useChangeList(source, filters, { kind: 'new', minSupport: scope.minSupport, enabled: active });
  const lostRead = useChangeList(source, filters, { kind: 'lost', minSupport: scope.minSupport, enabled: active });
  const read = kind === 'new' ? newRead : lostRead;
  const other = kind === 'new' ? lostRead : newRead;
  const scopeMeta = context.meta.data?.meta;
  const noPrevious = noPreviousAnswers(scopeMeta);

  // The search finds a listed domain by its name; the API has no search, so it never looks past the listed rows
  const [query, setQuery] = useState('');
  const rows = useMemo(() => rowsOf(read.data, noPrevious), [read.data, noPrevious]);
  const listed = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return needle === ''
      ? rows
      : rows.filter((row) => row.registrable_domain.toLocaleLowerCase(locale).includes(needle));
  }, [rows, query, locale]);

  const windowDays = daysIn(range);
  const meta = read.data?.meta;
  // The days a source must have been absent (New: the real length of the previous period, which is not always the
  // asked window's) or the days of answers a lost read needs (Lost)
  const newDays = meta === undefined ? windowDays : previousDays(meta);
  const days = kind === 'lost' ? (meta === undefined ? 3 * windowDays : lostDays(meta)) : newDays;
  const supportFrom = meta?.compare_window.from;
  const supportTo = meta?.compare_window.to;
  const supportWindow = useMemo(
    () => (supportFrom === undefined || supportTo === undefined ? null : { from: supportFrom, to: supportTo }),
    [supportFrom, supportTo],
  );
  const columns = useChangeColumns({ kind, t, timeZone, supportWindow });
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const visible = useMemo(() => parseColumns(scope.columns, columnIds, ['domain']), [scope.columns, columnIds]);

  const filtering = Object.keys(filterBar.values).length > 0 || query !== '';
  // A minimum other than the default can be what left no row: Clear filters puts it back
  const clearFilters = (): void => {
    filterBar.onClear();
    setQuery('');
    if (scope.minSupport !== DEFAULT_MIN_SUPPORT) setSearch({ min: null });
  };
  const countOf = (page: SourceChangePage | undefined): string => {
    const total = totalOf(page, noPrevious);
    return total === null ? EMPTY_VALUE : formatInteger(total);
  };

  let status: TableStatus;
  if (read.status === 'error') status = 'error';
  else if (read.status === 'loading') status = 'loading';
  else if (listed.length === 0) status = filtering ? 'filtered-empty' : 'empty';
  else status = read.retrying ? 'refetching' : 'ready';

  // Nothing to export: the page hides its button here, and a source left by the last tab is taken back
  useRegisterExport(context.registerExport, null);

  // The inspector: a row opens its domain, and the domains of the list on screen are the steps of Previous and Next
  const { inspect } = context;
  const setOrder = inspect?.setOrder;
  useEffect(() => {
    if (setOrder === undefined || !active) return;
    setOrder('domain', [...new Set(listed.map((row) => row.registrable_domain))]);
  }, [setOrder, active, listed]);
  const openDomain = inspect?.target?.type === 'domain' ? inspect.target.id.toLowerCase() : null;
  const activeRowId = useMemo(() => {
    const open = openDomain === null ? undefined : listed.find((row) => row.registrable_domain === openDomain);
    return open === undefined ? null : changeRowId(open);
  }, [listed, openDomain]);

  const cut = noPrevious ? null : truncatedOf(read.data);
  const sample =
    kind === 'new' && scopeMeta !== undefined
      ? t('sample', { answers: scopeMeta.answers, range: formatDateRange(range.from, range.to) })
      : undefined;

  const errorState = <ChangeFailed kind={kind} errorId={read.errorId} onRetry={read.retry} retrying={read.retrying} />;
  const emptyState = (
    <ChangeEmpty
      kind={kind}
      minSupport={scope.minSupport}
      days={days}
      noPrevious={noPrevious}
      onResetMinimum={() => setSearch({ min: null })}
    />
  );
  const filteredEmptyState = (
    <CitationFilteredEmptyState
      filterBar={filterBar}
      minSupport={scope.minSupport}
      filtering={filtering}
      onClear={clearFilters}
    />
  );
  // Below 768 px each kind is a list; the person may ask for the table when the screen is not touch-primary
  const layout = useCitationListLayout();
  const toolbarEnd = (
    <>
      <MinSupportSelect
        minSupport={scope.minSupport}
        onMinSupportChange={(next) => setSearch({ min: next === null ? null : String(next) })}
      />
      {layout.canSwitch ? <ListTableSwitch mode={layout.mode} onModeChange={layout.onModeChange} /> : null}
    </>
  );

  // The tab scrolls as a whole when the strip above leaves the table under 20rem (a phone), so it is never squeezed away
  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <SegmentedControl<ChangeKind>
          semantics="view"
          size="sm"
          label={t('label')}
          value={kind}
          onValueChange={(next) => setSearch({ kind: next === 'new' ? null : next, cols: null })}
          items={[
            { value: 'new', label: t('new'), count: countOf(newRead.data) },
            { value: 'lost', label: t('lost'), count: countOf(lostRead.data) },
          ]}
        />
        <MetricInfo
          name={t('ruleName')}
          definition={t('ruleDefinition')}
          formula={
            kind === 'new'
              ? t('ruleNew', { min: scope.minSupport, days: newDays })
              : t('ruleLost', { min: scope.minSupport })
          }
          denominatorText={sample}
          methodologyHref={METHODOLOGY_HREF}
        />
      </div>
      {read.errorId !== null && read.data !== undefined ? (
        <Banner
          tone="warning"
          placement="region"
          live
          message={tt('refreshFailed')}
          actions={
            <Button variant="secondary" size="sm" loading={read.retrying} onClick={read.retry}>
              {common('retry')}
            </Button>
          }
        />
      ) : null}
      {other.status === 'error' ? (
        <CountFailed kind={otherKind} onRetry={other.retry} retrying={other.retrying} />
      ) : null}
      {kind === 'lost' && meta !== undefined ? (
        <p className="type-meta">{t('lostCost', { days: lostDays(meta), window: lostWindowDays(meta) })}</p>
      ) : null}
      <div className="flex h-96 min-h-80 flex-col lg:h-auto lg:flex-1">
        {layout.mode === 'list' ? (
          <ChangeList
            kind={kind}
            sources={listed}
            timeZone={timeZone}
            status={status}
            search={query}
            onSearchChange={setQuery}
            activeRowId={activeRowId}
            toolbarEnd={toolbarEnd}
            footerNote={cut === null ? undefined : t('truncatedFooter', { limit: cut.shown, total: cut.total })}
            errorState={errorState}
            emptyState={emptyState}
            filteredEmptyState={filteredEmptyState}
            onOpenDomain={(registrable) => inspect?.open({ type: 'domain', id: registrable }, 'inspector')}
          />
        ) : (
          <DataTable<SourceChangeRow>
            caption={t(`caption.${kind}`)}
            itemNoun={{ one: t(`noun.${kind}.one`), other: t(`noun.${kind}.other`) }}
            columns={columns}
            getRowId={changeRowId}
            rows={listed}
            total={listed.length}
            // The server orders the list by units, and the table lists it as given
            sort={NO_SORT}
            onSortChange={nothing}
            defaultSort={NO_SORT}
            compactToolbar
            toolbarEnd={toolbarEnd}
            footerNote={cut === null ? undefined : t('truncatedFooter', { limit: cut.shown, total: cut.total })}
            density={scope.density}
            onDensityChange={(next: Density) => setSearch({ density: next === DEFAULT_DENSITY ? null : next })}
            columnState={{
              visible,
              onChange: (next) => setSearch({ cols: next === null ? null : formatColumns(next) }),
            }}
            search={query}
            onSearchChange={setQuery}
            searchPlaceholder={tt('search')}
            rowName={rowName}
            onRowOpen={
              inspect === undefined
                ? undefined
                : (row, intent) => inspect.open({ type: 'domain', id: row.registrable_domain }, intent)
            }
            activeRowId={activeRowId}
            rowTone={ownRow}
            status={status}
            errorState={errorState}
            emptyState={emptyState}
            filteredEmptyState={filteredEmptyState}
          />
        )}
      </div>
    </div>
  );
}
