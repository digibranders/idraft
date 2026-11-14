'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { STATUSES, type AnswerStatus, type DayCounts } from './model/status-model';
import { useDailyCsv, useDayText } from './parts/daily-table';
import { NarrowReserve } from './parts/loading-controls';
import { useDailyCard } from './parts/use-daily-card';
import { useCardExport } from '../engines/use-card-seams';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import { escapeHtml, type CategorySeries, type SeriesRole } from '@/lib/charts/category-chart';
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatInteger } from '@/lib/format';

/**
 * Valid is the reference token and the other statuses follow the palette in order. `complete` is the valid answers
 * that are not partial, so the five segments of a day stack to its answers and valid is the first two together.
 */
const ROLES: Readonly<Record<AnswerStatus, SeriesRole>> = {
  complete: { kind: 'reference' },
  partial: { kind: 'palette', index: 2 },
  empty: { kind: 'palette', index: 3 },
  refused: { kind: 'palette', index: 4 },
  error: { kind: 'palette', index: 5 },
};

const NAME_KEYS = {
  complete: 'seriesComplete',
  partial: 'seriesPartial',
  empty: 'seriesEmpty',
  refused: 'seriesRefused',
  error: 'seriesError',
} as const satisfies Record<AnswerStatus, string>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** A tooltip row of a fact that is not a series: the same layout as `tipRowHtml`, without its swatch. */
function plainRowHtml(name: string, valueText: string, tokens: ChartTokens, first = false): string {
  const gap = first ? 'margin-top:4px;' : '';
  return `<div style="${gap}display:flex;gap:8px;align-items:center"><span style="color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(name)}</span><span style="margin-left:auto;font-variant-numeric:tabular-nums">${escapeHtml(valueText)}</span></div>`;
}

interface TipParam {
  dataIndex?: number;
  axisValueLabel?: string;
}

/** The series the frame draws now (a legend toggle hides one): id, name and colour, in stack order. */
function shownLines(option: Record<string, unknown>): { id: string; name: string; color: string | undefined }[] {
  const list = Array.isArray(option.series) ? (option.series as unknown[]) : [];
  return list.flatMap((entry) => {
    const line = recordOf(entry);
    return typeof line.id === 'string'
      ? [
          {
            id: line.id,
            name: typeof line.name === 'string' ? line.name : '',
            color: typeof line.color === 'string' ? line.color : undefined,
          },
        ]
      : [];
  });
}

/**
 * CH-21: the answers of each run day of one engine by status, as stacked bars of counts (not rates). The tooltip of a
 * day gives the counts and what the schedules planned (Schedule unknown where the route cannot say, never 0), and a
 * run blocked by the budget. One engine at a time: engines are never added together.
 */
export default function AnswerStatusCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.activity.status');
  const daily = useTranslations('aiOverview.activity.daily');
  const card = useDailyCard(live, t('subject'), { patterns: true });
  const dayText = useDayText();
  const toCsv = useDailyCsv();
  const csv = toCsv(card.allRunDays);
  useCardExport(item.id, () => (card.shown ? { id: item.id, ...csv } : null));
  const { runDays } = card;

  const categories = useMemo(() => runDays.map((entry) => formatChartDate(entry.date)), [runDays]);
  const series = useMemo(
    (): CategorySeries[] =>
      STATUSES.map((status) => ({
        id: status,
        name: t(NAME_KEYS[status]),
        role: ROLES[status],
        values: runDays.map((entry) => entry[status]),
      })),
    [runDays, t],
  );

  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> => {
      const lines = shownLines(option);
      const axis = recordOf(option.yAxis);
      const tooltip = (params: readonly TipParam[]): string => {
        const first = params[0];
        const entry: DayCounts | undefined = runDays[first?.dataIndex ?? -1];
        if (entry === undefined) return tipTitleHtml(first?.axisValueLabel ?? '');
        const rows = lines.flatMap((line) => {
          const status = STATUSES.find((candidate) => candidate === line.id);
          return status === undefined
            ? []
            : [tipRowHtml(line.color ?? tokens.other, line.name, formatInteger(entry[status]), tokens)];
        });
        // Not series, so no swatch: the valid total (complete plus partial), what was scheduled, and blocked runs
        const scheduled = entry.scheduled === null ? daily('scheduleUnknown') : formatInteger(entry.scheduled);
        rows.push(plainRowHtml(t('tooltipValid'), formatInteger(entry.valid), tokens, true));
        rows.push(plainRowHtml(t('tooltipScheduled'), scheduled, tokens));
        if (entry.budgetBlocked > 0) {
          rows.push(plainRowHtml(t('tooltipBlocked'), formatInteger(entry.budgetBlocked), tokens));
        }
        return `${tipTitleHtml(dayText(entry.date))}${rows.join('')}`;
      };
      return {
        ...option,
        // Counts: whole numbers on the axis
        yAxis: { ...axis, minInterval: 1 },
        tooltip: { ...recordOf(option.tooltip), formatter: tooltip },
      };
    },
    [runDays, dayText, t, daily],
  );

  const { totals } = card;
  const summary = card.shown
    ? t('summary', {
        engine: card.engineName,
        valid: formatInteger(totals.valid),
        answers: formatInteger(totals.answers),
        empty: formatInteger(totals.empty),
        refused: formatInteger(totals.refused),
        error: totals.error,
        errorText: formatInteger(totals.error),
      })
    : t('title');
  return (
    <ChartFrame
      kind="bar"
      variant="panel"
      height={240}
      title={t('title')}
      meta={card.meta}
      summary={summary}
      controls={card.controls}
      footnote={
        <>
          <p>{daily('footnote')}</p>
          {card.loading ? <NarrowReserve calendarKey={false} /> : null}
        </>
      }
      categories={categories}
      categoryHeader={t('categoryHeader')}
      series={series}
      formatValue={formatInteger}
      extendOption={extendOption}
      stacked
      menu={{ fileName: t('fileName'), png: true, csv }}
      {...card.frame}
    />
  );
}
