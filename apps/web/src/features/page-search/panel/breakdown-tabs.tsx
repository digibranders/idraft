'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';

import { Busy, LoadError } from './panel-states';
import { PANEL_TABS, type PanelTab } from './use-panel-state';
import { changeOf, nameOf, sortRows } from '../breakdown';
import { breakdownQuery } from '../queries';
import type { BreakdownDimension, BreakdownRow, MetricKey, PageNumbers, PeriodParams, SearchScope } from '../types';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { isApiProblem } from '@/lib/api/problem';
import { formatDecimal, formatInteger, formatPercent, formatPointsDelta, formatSignedInteger } from '@/lib/format';

/** The code of the `429` the API answers while Google is busy. */
const BUSY_CODE = 'gsc_busy';
/** The most rows drawn before "Show all". */
const SHOWN_ROWS = 25;

const DIMENSION: Record<PanelTab, BreakdownDimension> = {
  queries: 'query',
  locations: 'country',
  devices: 'device',
};

const valueOf = (numbers: PageNumbers, metric: MetricKey): string => {
  switch (metric) {
    case 'clicks':
    case 'impressions':
      return formatInteger(numbers[metric]);
    case 'ctr':
      return formatPercent(numbers.ctr);
    case 'position':
      return formatDecimal(numbers.position, 1);
  }
};

export interface BreakdownTabsProps {
  scope: SearchScope;
  urlId: string;
  period: PeriodParams;
  /** The first ticked metric: the one the Now, Before and Change columns are about. */
  metric: MetricKey;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}

/** What changed (spec 10.3 item 5): the queries, locations and devices of the period. Only the open tab is read. */
export function BreakdownTabs({ scope, urlId, period, metric, tab, onTabChange }: BreakdownTabsProps): ReactElement {
  const t = useTranslations('pageSearch');
  return (
    <InspectorSection title={t('whatChanged')} status="ready">
      <Tabs<PanelTab>
        variant="segmented"
        label={t('whatChanged')}
        value={tab}
        onValueChange={onTabChange}
        className="gap-3"
        items={PANEL_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
      >
        {PANEL_TABS.map((value) => (
          <TabsPanel key={value} value={value}>
            <BreakdownTable tab={value} scope={scope} urlId={urlId} period={period} metric={metric} />
          </TabsPanel>
        ))}
      </Tabs>
    </InspectorSection>
  );
}

interface BreakdownTableProps {
  tab: PanelTab;
  scope: SearchScope;
  urlId: string;
  period: PeriodParams;
  metric: MetricKey;
}

function BreakdownTable({ tab, scope, urlId, period, metric }: BreakdownTableProps): ReactElement {
  const t = useTranslations('pageSearch');
  const locale = useLocale();
  const [showAll, setShowAll] = useState(false);
  const dimension = DIMENSION[tab];
  const read = useQuery({ ...breakdownQuery(scope, urlId, dimension, period), placeholderData: keepPreviousData });
  const answer = read.data;
  const rows = useMemo(() => sortRows(answer?.data ?? [], metric), [answer, metric]);

  const notCollected = t('states.notCollected');
  const compared = answer?.meta.compare_window != null;
  const numbersCell = (numbers: PageNumbers | null): string =>
    numbers === null ? notCollected : valueOf(numbers, metric);
  const changeCell = (row: BreakdownRow): string => {
    if (row.current === null || row.previous === null) return notCollected;
    const change = changeOf(row, metric);
    switch (metric) {
      case 'clicks':
      case 'impressions':
        return formatSignedInteger(change);
      case 'ctr':
        return formatPointsDelta(change);
      case 'position': {
        if (change === null) return formatDecimal(null, 1);
        const places = formatDecimal(Math.abs(change), 1);
        if (places === formatDecimal(0, 1)) return places;
        return t(change > 0 ? 'positionImproved' : 'positionSlipped', { places });
      }
    }
  };
  const nameCell = (row: BreakdownRow): string => {
    const name = nameOf(dimension, row.key, locale);
    return name.kind === 'text' ? name.text : t(name.key);
  };

  const named = { metric: t(`metrics.${metric}`) };
  const columns: PlainColumn<BreakdownRow>[] = [
    { id: 'name', header: t(`names.${tab}`), cell: nameCell },
    { id: 'now', header: t('columns.now', named), cell: (row) => numbersCell(row.current) },
    ...(compared
      ? [
          { id: 'before', header: t('columns.before', named), cell: (row: BreakdownRow) => numbersCell(row.previous) },
          { id: 'change', header: t('columns.change', named), cell: changeCell },
        ]
      : []),
  ];
  // The change of a count is the difference of the totals, so it needs saying when the periods differ in length
  const totalsOfUnequalPeriods =
    (metric === 'clicks' || metric === 'impressions') &&
    answer?.meta.window != null &&
    answer.meta.compare_window != null &&
    answer.meta.window.days !== answer.meta.compare_window.days;

  const coverage = tab === 'queries' ? (answer?.meta.coverage ?? null) : null;
  const shown = showAll ? rows : rows.slice(0, SHOWN_ROWS);
  const retry = (): void => {
    void read.refetch();
  };
  return (
    <div className="flex flex-col gap-2">
      <PlainTable
        caption={t(`tabs.${tab}`)}
        columns={columns}
        rows={shown}
        rowKey={(row) => row.key}
        status={read.isError && answer === undefined ? 'error' : answer === undefined ? 'loading' : 'ready'}
        errorState={
          <div className="p-4">
            {isApiProblem(read.error, BUSY_CODE) ? (
              <Busy seconds={read.error.retryAfterSeconds ?? 0} onRetry={retry} />
            ) : (
              <LoadError error={read.error} retrying={read.isFetching} onRetry={retry} />
            )}
          </div>
        }
        emptyText={notCollected}
      />
      {rows.length > SHOWN_ROWS && !showAll ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setShowAll(true);
          }}
        >
          {t('showAll', { count: formatInteger(rows.length) })}
        </Button>
      ) : null}
      {totalsOfUnequalPeriods ? <p className="type-meta text-foreground-tertiary">{t('breakdownLengths')}</p> : null}
      {coverage === null ? null : (
        <p className="type-meta text-foreground-tertiary">
          {t('coverage', { percent: formatPercent(coverage, { decimals: 0 }) })}
        </p>
      )}
    </div>
  );
}
