'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { record, roleOf, type SeriesOption, type TooltipParam } from './chart-parts';
import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { entityTotals } from './model/entity-totals';
import { colorSlots } from './model/tracked-set';
import { trimIdleShares } from './model/trim-weeks';
import type { EngineEntityTotals, FoldedPoint, TrackedEntity, TrackedSet } from './model/types';
import { foldOthers, weeklyShares } from './model/weekly-series';
import { useCardEngine } from './parts/card-engine';
import { frameSummary, useFrameState, type DataSituation, type FrameState, type ReadFacts } from './parts/frame-state';
import { TrackedFootnote } from './parts/tracked-footnote';
import { loadingBodyHeight } from './skeletons';
import { useOverview, useOverviewSummary } from '../../overview-context';
import { useCardMeta } from '../engines/card-meta';
import { useCardExport } from '../engines/use-card-seams';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
import { boundaryMarkLines, type ChartBoundary } from '@/lib/charts/boundaries';
import { escapeHtml, type CategorySeries } from '@/lib/charts/category-chart';
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatDateRange, formatList, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * CH-19, `ai.sov_over_time`: the weekly share of voice of every tracked brand on one engine as 100 percent columns.
 * Shares of one answer each add up to 1 by construction, so a column is a whole; you are at the bottom, competitors
 * by their colour slot, "Other tracked" on top. A week with fewer than 4 answers naming a tracked brand is an empty
 * column that says so, never a column of zeros. The tracked set boundary is a dashed line (D-9).
 */

const HEIGHT = 280;
const LOADING_HEIGHT = loadingBodyHeight('ai.sov_over_time');
const OTHER_ID = 'other';
const TOO_FEW_ID = 'too-few';
const formatShare = (value: number): string => formatPercent(value, { decimals: 0 });

interface Brand {
  entity: TrackedEntity;
  slot: number;
}

interface ColumnsModel {
  totals: EngineEntityTotals;
  /** Bottom to top: you, then the competitors by slot. */
  brands: readonly Brand[];
  /** The names of the tracked brands with no colour slot, folded into "Other tracked". */
  others: readonly string[];
  points: readonly FoldedPoint[];
  /** Weeks in which any answer names a tracked brand. */
  weeksWithAnswers: number;
  /** Weeks with enough such answers to draw a column. */
  weeksDrawn: number;
}

function columnsModel(
  summary: PromptsSummary | undefined,
  set: TrackedSet | null,
  engineCode: string,
): ColumnsModel | 'unread' | null {
  if (summary === undefined || set === null) return null;
  const totals = entityTotals(summary, engineCode, set);
  const weekly = weeklyShares(summary, engineCode, set);
  if (totals.status !== 'read' || weekly.status !== 'read') return 'unread';
  const slots = colorSlots(set);
  const brands = [...slots.entries()].flatMap(([entityId, slot]) => {
    const entity = set.entities.find((candidate) => candidate.entityId === entityId);
    return entity === undefined ? [] : [{ entity, slot }];
  });
  // The idle weeks at the ends are not drawn (an empty slot on the axis); the counts below are of what is drawn
  const drawn = trimIdleShares(weekly.points);
  return {
    totals,
    brands,
    others: set.entities.filter((entity) => !slots.has(entity.entityId)).map((entity) => entity.name),
    points: drawn.map((point) => foldOthers(point, set)),
    weeksWithAnswers: drawn.filter((point) => point.answers > 0).length,
    weeksDrawn: drawn.filter((point) => point.state === 'ok').length,
  };
}

/** What the tooltip of one week says: the shares best first, or why the column is empty. */
interface WeekTip {
  title: string;
  rows: readonly { seriesId: string; value: number }[];
  /** The denominator of the shares, or the sentence of an empty column. */
  footer: string;
  empty: boolean;
}

/**
 * The stacked columns as a share of a whole: the axis is 0 to 1, the columns overlap one slot (so the empty column
 * of a thin week sits where the others would), a 1 px separator keeps neighbours apart, and the tooltip says the
 * shares with their denominator. An empty column is a dashed outline whose tooltip says "too few", because a bar with
 * no value has no tooltip of its own.
 */
function stackedShareOption(
  base: Record<string, unknown>,
  tokens: ChartTokens,
  { tips, boundaries }: { tips: readonly WeekTip[]; boundaries: readonly ChartBoundary[] },
): Record<string, unknown> {
  const shown = (Array.isArray(base.series) ? base.series : []) as SeriesOption[];
  const categories = (record(base.xAxis).data ?? []) as string[];
  const columns = shown.map((entry) => ({
    ...entry,
    barGap: '-100%',
    itemStyle: { ...entry.itemStyle, borderColor: tokens.surfaceElevated, borderWidth: 1 },
  }));
  const empty = {
    id: TOO_FEW_ID,
    name: '',
    type: 'bar',
    stack: TOO_FEW_ID,
    barMaxWidth: 24,
    barGap: '-100%',
    data: tips.map((tip) => (tip.empty ? 1 : null)),
    itemStyle: { color: 'transparent', borderColor: tokens.border, borderWidth: 1, borderType: 'dashed' },
  };
  const formatter = (params: readonly TooltipParam[]): string => {
    const [first] = params;
    const tip = tips[first?.dataIndex ?? -1];
    if (tip === undefined) return tipTitleHtml(first?.axisValueLabel ?? '');
    const rows = [...tip.rows]
      .sort((a, b) => b.value - a.value)
      .flatMap((row) => {
        const entry = shown.find((candidate) => candidate.id === row.seriesId);
        return entry === undefined
          ? []
          : [tipRowHtml(entry.color ?? tokens.other, entry.name ?? '', formatShare(row.value), tokens)];
      });
    return `${tipTitleHtml(tip.title)}${rows.join('')}<div style="margin-top:4px;color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(tip.footer)}</div>`;
  };
  const boundary = boundaryMarkLines(boundaries, categories, tokens);
  return {
    ...base,
    yAxis: { ...record(base.yAxis), min: 0, max: 1, interval: 0.25 },
    tooltip: { ...record(base.tooltip), formatter },
    series: [...columns, empty, ...(boundary === null ? [] : [boundary])],
  };
}

export default function SovOverTimeCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.sovOverTime');
  const cardMeta = useCardMeta();
  const { scope } = useOverview();
  const engine = useCardEngine(options);
  // The weekly shape without its previous window: this card draws no comparison, so it asks for none
  const read = useOverviewSummary({ ...SHAPE_OPTIONS.weekly, subscribed: live });
  const summary = read.data;
  const set = useTrackedSet(summary);
  const model = useMemo(() => columnsModel(summary, set, engine.code), [summary, set, engine.code]);
  const ready = model !== null && model !== 'unread' ? model : null;
  const points = useMemo(() => ready?.points ?? [], [ready]);
  const brands = useMemo(() => ready?.brands ?? [], [ready]);
  const otherName = t('other');

  const tooFew = useCallback((answers: number): string => t('tooFew', { answers, min: MIN_OBSERVATIONS }), [t]);
  const weekTitle = useCallback(
    (point: FoldedPoint): string =>
      point.pool !== null && point.pool.weeks > 1
        ? t('weekTitlePooled', {
            date: formatChartDate(point.weekStart),
            weeks: point.pool.weeks,
            range: formatDateRange(point.pool.from, point.pool.to),
          })
        : t('weekTitle', { date: formatChartDate(point.weekStart) }),
    [t],
  );
  const categories = useMemo(() => points.map((point) => formatChartDate(point.weekStart)), [points]);
  const series = useMemo((): CategorySeries[] => {
    const own = brands.map(({ entity, slot }): CategorySeries => ({
      id: entity.entityId,
      name: entity.name,
      role: roleOf(slot),
      values: points.map(
        (point) =>
          (point.state === 'ok' ? point.entities.find((entry) => entry.entityId === entity.entityId)?.value : null) ??
          null,
      ),
    }));
    return ready !== null && ready.others.length > 0
      ? [
          ...own,
          {
            id: OTHER_ID,
            name: otherName,
            role: { kind: 'other' },
            values: points.map((point) => (point.state === 'ok' ? point.other : null)),
          },
        ]
      : own;
  }, [ready, brands, points, otherName]);
  const tips = useMemo(
    (): WeekTip[] =>
      points.map((point) => {
        const title = weekTitle(point);
        if (point.state !== 'ok') return { title, rows: [], footer: tooFew(point.answers), empty: true };
        return {
          title,
          rows: series.flatMap((entry) => {
            const value = entry.values[points.indexOf(point)];
            return typeof value === 'number' ? [{ seriesId: entry.id, value }] : [];
          }),
          footer: t('tooltipAnswers', { answers: point.answers }),
          empty: false,
        };
      }),
    [points, series, weekTitle, tooFew, t],
  );
  const boundaries = useMemo(
    (): ChartBoundary[] =>
      (set?.boundaries ?? []).map((boundary) => ({
        at: formatChartDate(boundary.weekStart),
        label: t('boundaryAdded', { name: boundary.name }),
      })),
    [set, t],
  );
  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> =>
      stackedShareOption(option, tokens, { tips, boundaries }),
    [tips, boundaries],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => {
      const point = points[index];
      if (point === undefined) return null;
      if (point.state !== 'ok') return tooFew(point.answers);
      const value = series.find((entry) => entry.id === seriesId)?.values[index];
      return typeof value === 'number' ? t('cell', { value: formatShare(value), answers: point.answers }) : null;
    },
    [points, series, tooFew, t],
  );

  const summaryText = useMemo((): string => {
    const latest = [...points].reverse().find((point) => point.state === 'ok');
    const value = latest?.entities.find(
      (entry) => entry.entityId === brands.find((brand) => brand.slot === 1)?.entity.entityId,
    )?.value;
    if (latest === undefined || value === null || value === undefined)
      return t('summaryNone', { engine: engine.label });
    return t('summary', {
      engine: engine.label,
      date: formatChartDate(latest.weekStart),
      value: formatShare(value),
      answers: latest.answers,
    });
  }, [points, brands, engine.label, t]);

  const readFacts: ReadFacts =
    model === 'unread' ? { status: 'error', errorId: read.errorId, stale: false, refetch: read.refetch } : read;
  const situation: DataSituation =
    set !== null && !set.entities.some((entity) => entity.role === 'competitor')
      ? { kind: 'no_competitor' }
      : ready !== null && ready.totals.validAnswers === 0
        ? { kind: 'no_answers' }
        : ready !== null && ready.weeksWithAnswers >= 2 && ready.weeksDrawn === 0
          ? { kind: 'too_few', answers: ready.totals.answersNamingTracked }
          : { kind: 'ready' };
  const base = useFrameState({
    subject: t('subject'),
    read: readFacts,
    previous: null,
    previousEmpty: false,
    engine,
    situation,
  });
  const needsWeeks: FrameState = {
    status: 'empty',
    empty: { title: t('needsWeeksTitle'), reason: t('needsWeeksReason', { engine: engine.label }) },
  };
  const frame: FrameState =
    (base.status === 'ready' || base.status === 'refetching') && ready !== null && ready.weeksWithAnswers < 2
      ? needsWeeks
      : base;

  useCardExport(item.id, () => {
    if (ready === null || (frame.status !== 'ready' && frame.status !== 'refetching')) return null;
    return {
      id: item.id,
      header: [t('weekColumn'), t('exportBrand'), t('exportShare'), t('exportAnswers'), t('exportState')],
      rows: points.flatMap((point) =>
        series.map((entry) => {
          const value = entry.values[points.indexOf(point)];
          return [
            point.weekStart,
            entry.name,
            typeof value === 'number' ? Math.round(value * 1000) / 10 : null,
            point.answers,
            point.state,
          ];
        }),
      ),
    };
  });

  const pooled = points.some((point) => point.pool !== null && point.pool.weeks > 1);
  const meta =
    summary === undefined || ready === null
      ? null
      : cardMeta({
          range: { from: summary.window.from, to: summary.window.to },
          prompts: summary.total?.prompt_count ?? null,
          answers: ready.totals.validAnswers,
          branded: scope.branded,
        });

  return (
    <ChartFrame
      kind="bar"
      stacked
      variant="panel"
      title={t('title', { engine: engine.label })}
      meta={meta}
      footnote={
        set === null ? null : (
          <>
            <TrackedFootnote set={set} />
            {ready === null || ready.others.length === 0 ? null : (
              <p>{t('footnoteOthers', { count: ready.others.length, names: formatList(ready.others) })}</p>
            )}
            <p>{t('footnoteColumns', { min: MIN_OBSERVATIONS })}</p>
            {pooled ? <p>{t('footnotePooled')}</p> : null}
          </>
        )
      }
      height={HEIGHT}
      loadingHeight={LOADING_HEIGHT}
      summary={frameSummary(frame, summaryText)}
      categories={categories}
      categoryHeader={t('weekColumn')}
      series={series}
      formatValue={formatShare}
      cellText={cellText}
      extendOption={extendOption}
      menu={{ fileName: t('fileName', { engine: engine.code }), png: true, csv: true }}
      {...frame}
    />
  );
}
