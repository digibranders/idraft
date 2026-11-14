'use client';

import { ChartColumn, LineChart } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import type { SourceEngineFigure, SourceFigures, SourceTrend, SourceTrendCell } from './source-model';
import type { SourceRowState } from './source-strip';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Tooltip } from '@/components/ui/tooltip';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import type { ErrorIdWords } from '@/lib/api/use-error-id';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { EMPTY_VALUE, formatChartDate, formatDateRange, formatInteger, formatPercent } from '@/lib/format';

export interface SourceOverviewProps {
  /** How the page's row is going: both cards load, fail and say "not known" with it. */
  state: SourceRowState;
  figures: SourceFigures | null;
  trend: SourceTrend | null;
  /** The window the read covers, for the meta line. */
  range: { from: string; to: string };
  /** The engines with their names; an engine of the read that is not here is named by its code. */
  engines: readonly { code: string; label: string }[];
  errorId: ErrorIdWords | null;
  retry: () => void;
  retrying: boolean;
  /** A read is on its way while the cards are on screen: they stay, marked busy. */
  refetching: boolean;
}

/** The height the inspector's charts are drawn at. */
const CHART_HEIGHT = 180;
/** The one line of the chart is every engine together, and is named so. */
const LINE_ID = 'all-engines';

/** A tooltip on an element nothing focuses reaches no keyboard user (20 section 6.2 rule 6); the lint rule cannot see why. */
const FOCUSABLE = { tabIndex: 0 } as const;

/** A figure that is not known, with the reason in a tooltip the keyboard reaches. Never a 0. */
function Unknown({ reason }: { reason: string }): ReactElement {
  return (
    <Tooltip content={reason}>
      <span {...FOCUSABLE} className="rounded-sm text-foreground-tertiary outline-none focus-visible:focus-ring">
        {EMPTY_VALUE}
      </span>
    </Tooltip>
  );
}

interface TooltipParam {
  dataIndex?: number;
  axisValueLabel?: string;
}
interface DrawnSeries {
  color?: string;
}

interface CardStates {
  status: InspectorSectionStatus;
  error: ReactElement;
  empty: ReactElement;
}

/**
 * The Overview tab (WB-SRC-01): the weekly trend of the page's share of every citation unit, all engines together
 * (the one line says so), and the breakdown by engine. Each card loads and fails alone, and says why when the page's
 * totals are not known (it is past the 200 pages listed): never a bar at 0.
 */
export function SourceOverview(props: SourceOverviewProps): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  const common = useTranslations('common');
  const { state, errorId, retry, retrying } = props;
  const failed = (
    <InlineError
      title={t('totalsFailed')}
      reason={t('loadFailedReason')}
      errorId={errorId}
      onRetry={retry}
      retrying={retrying}
      retryLabel={common('retry')}
    />
  );
  const unknown = (
    <EmptyState variant="inline" title={t('totalsUnknownTitle')} reason={t('rowMissing')} headingLevel={3} />
  );
  const status: InspectorSectionStatus =
    state === 'ready' ? 'ready' : state === 'missing' ? 'empty' : state === 'error' ? 'error' : 'loading';
  const card: CardStates = { status, error: failed, empty: unknown };
  return (
    <>
      <SourceTrendCard {...props} card={card} />
      <SourceEngineCard {...props} card={card} />
    </>
  );
}

function SourceTrendCard({ trend, range, card, refetching }: SourceOverviewProps & { card: CardStates }): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  const locale = useLocale();
  const formatValue = useCallback((value: number): string => formatPercent(value, { locale }), [locale]);
  const pointText = useCallback(
    (value: number, cell: SourceTrendCell): string =>
      t('trendCellShare', { share: formatValue(value), units: cell.units, total: cell.total }),
    [t, formatValue],
  );
  const categories = useMemo(() => (trend?.weeks ?? []).map((week) => formatChartDate(week)), [trend]);
  const series = useMemo(
    (): CategorySeries[] =>
      trend === null ? [] : [{ id: LINE_ID, name: t('trendSeries'), role: { kind: 'brand' }, values: trend.values }],
    [trend, t],
  );
  const cellText = useCallback(
    (_seriesId: string, index: number): string | null => {
      const value = trend?.values[index];
      const cell = trend?.cells[index];
      return value == null || cell == null ? null : pointText(value, cell);
    },
    [trend, pointText],
  );
  /** The tooltip says the point with its count; a week with no figure has no row, so nothing claims 0%. */
  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> => {
      const [line] = (option.series as DrawnSeries[] | undefined) ?? [];
      const baseTooltip = (option.tooltip as Record<string, unknown> | undefined) ?? {};
      const formatter = (params: readonly TooltipParam[]): string => {
        const [first] = params;
        const index = first?.dataIndex ?? -1;
        const value = trend?.values[index];
        const cell = trend?.cells[index];
        const row =
          value == null || cell == null
            ? ''
            : tipRowHtml(line?.color ?? tokens.other, t('trendSeries'), pointText(value, cell), tokens);
        return `${tipTitleHtml(first?.axisValueLabel ?? categories[index] ?? '')}${row}`;
      };
      return { ...option, tooltip: { ...baseTooltip, formatter } };
    },
    [trend, categories, pointText, t],
  );

  const title = t('trendTitle');
  if (card.status !== 'ready' || trend === null) {
    // A ready row with no week to draw has its own words; the others are the row's
    const noWeeks = card.status === 'ready';
    return (
      <InspectorSection
        title={title}
        icon={LineChart}
        status={noWeeks ? 'empty' : card.status}
        error={card.error}
        empty={
          noWeeks ? (
            <EmptyState variant="inline" title={t('trendEmptyTitle')} reason={t('trendEmptyReason')} headingLevel={3} />
          ) : (
            card.empty
          )
        }
      />
    );
  }
  return (
    <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame
        title={title}
        variant="inspector"
        meta={t('trendMeta', { range: formatDateRange(range.from, range.to) })}
        footnote={<p>{t('trendGapNote')}</p>}
        kind="line"
        categories={categories}
        categoryHeader={t('trendWeek')}
        cellText={cellText}
        series={series}
        formatValue={formatValue}
        height={CHART_HEIGHT}
        summary={t('trendSummary')}
        status={refetching ? 'refetching' : 'ready'}
        extendOption={extendOption}
      />
    </div>
  );
}

function SourceEngineCard({
  figures,
  engines,
  card,
  refetching,
}: SourceOverviewProps & { card: CardStates }): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  const locale = useLocale();
  const labelOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;

  const columns: PlainColumn<SourceEngineFigure>[] = [
    { id: 'engine', header: t('engineHeader'), cell: (row) => labelOf(row.code) },
    {
      id: 'units',
      header: t('engineUnits'),
      cell: (row) =>
        row.units === null ? (
          <Unknown reason={t('engineUnknown', { engine: labelOf(row.code) })} />
        ) : (
          formatInteger(row.units, { locale })
        ),
    },
    {
      id: 'share',
      header: t('engineShare'),
      wrap: true,
      cell: (row) => {
        if (row.units === null || row.total === null)
          return <Unknown reason={t('engineUnknown', { engine: labelOf(row.code) })} />;
        if (row.share === null) return <Unknown reason={t('engineNone', { engine: labelOf(row.code) })} />;
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span className="type-body-strong text-foreground">{formatPercent(row.share, { locale })}</span>
            <span aria-hidden="true" className="type-meta">
              {t('engineShareContext', { units: row.units, total: row.total })}
            </span>
            <span className="sr-only">
              {t('engineCell', { units: row.units, total: row.total, engine: labelOf(row.code) })}
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <InspectorSection
      title={t('enginesTitle')}
      icon={ChartColumn}
      status={card.status}
      error={card.error}
      empty={card.empty}
    >
      <div aria-busy={refetching ? true : undefined}>
        <PlainTable<SourceEngineFigure>
          caption={t('engineCaption')}
          columns={columns}
          rows={figures?.engines ?? []}
          rowKey={(row) => row.code}
          status="ready"
          errorState={null}
          emptyText={t('notCitedTitle')}
        />
      </div>
    </InspectorSection>
  );
}
