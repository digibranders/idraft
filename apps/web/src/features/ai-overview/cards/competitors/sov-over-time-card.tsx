'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { record, roleOf, type SeriesOption, type TooltipParam } from './chart-parts';
import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { shareAcrossPlatforms, type ScopeShareRead } from './model/scope-share';
import { weeklySharesAcross } from './model/scope-weekly';
import { colorSlots } from './model/tracked-set';
import { trimIdleShares } from './model/trim-weeks';
import {
  isUnreadable,
  unreadWhy,
  type FoldedPoint,
  type TrackedEntity,
  type TrackedSet,
  type Unreadable,
} from './model/types';
import { foldOthers } from './model/weekly-series';
import { useCardPlatforms } from './parts/card-engine';
import { frameSummary, useFrameState, type DataSituation, type FrameState } from './parts/frame-state';
import { TrackedFootnote } from './parts/tracked-footnote';
import { loadingBodyHeight } from './skeletons';
import { useCardExport } from '../engines/use-card-seams';
import { useOverviewSummary } from '../../overview-context';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
import { boundaryMarkLines, type ChartBoundary } from '@/lib/charts/boundaries';
import { escapeHtml, type CategorySeries } from '@/lib/charts/category-chart';
import { fadeDown } from '@/lib/charts/rich-style';
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatDateRange, formatList, formatPercent } from '@/lib/format';
import { engineLabel } from '@/lib/layouts';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * CH-19 and OV-SOVT, `ai.sov_over_time`: the weekly share of voice of every tracked brand over the platforms of the page
 * scope, stacked to 100%. One platform is its own weekly shares; All platforms is the week by week equal-weight average
 * of the platforms that have a share that week (R3). Shares of one answer each add up to 1 by construction, so a week is
 * a whole; you are at the bottom, competitors by their colour slot, "Other tracked" on top. A week with no platform that
 * has 4 answers naming a tracked brand is a gap that says so, never a week of zeros. The tracked set boundary is a
 * dashed line (D-9).
 */

const HEIGHT = 240;
const LOADING_HEIGHT = loadingBodyHeight('ai.sov_over_time');
const OTHER_ID = 'other';
const formatShare = (value: number): string => formatPercent(value, { decimals: 0 });
/** The own layer is nearly solid, the competitors' fainter, so you read first (OV-SOVT-01). */
const OWN_OPACITY = 0.95;
const OTHER_OPACITY = 0.55;

interface Brand {
  entity: TrackedEntity;
  slot: number;
}

interface WeeksModel {
  shares: Extract<ScopeShareRead, { status: 'read' }>;
  /** Bottom to top: you, then the competitors by slot. */
  brands: readonly Brand[];
  /** The names of the tracked brands with no colour slot, folded into "Other tracked". */
  others: readonly string[];
  points: readonly FoldedPoint[];
  weeksWithAnswers: number;
  weeksDrawn: number;
}

function weeksModel(
  summary: PromptsSummary | undefined,
  set: TrackedSet | null,
  codes: readonly string[],
  average: boolean,
): WeeksModel | Unreadable | null {
  if (summary === undefined || set === null || codes.length === 0) return null;
  const shares = shareAcrossPlatforms(summary, codes, set, average);
  const weekly = weeklySharesAcross(summary, codes, set);
  if (shares.status !== 'read' || weekly.status !== 'read') return { unread: unreadWhy(shares, weekly) };
  const slots = colorSlots(set);
  const brands = [...slots.entries()].flatMap(([entityId, slot]) => {
    const entity = set.entities.find((candidate) => candidate.entityId === entityId);
    return entity === undefined ? [] : [{ entity, slot }];
  });
  // The idle weeks at the ends are not drawn (an empty slot on the axis); the counts below are of what is drawn
  const drawn = trimIdleShares(weekly.points);
  return {
    shares,
    brands,
    others: set.entities.filter((entity) => !slots.has(entity.entityId)).map((entity) => entity.name),
    points: drawn.map((point) => foldOthers(point, set)),
    weeksWithAnswers: drawn.filter((point) => point.answers > 0).length,
    weeksDrawn: drawn.filter((point) => point.state === 'ok').length,
  };
}

/** What the tooltip of one week says: the shares best first, each with its brand mentions, or why the week has none. */
interface WeekTip {
  title: string;
  rows: readonly { seriesId: string; value: number; text: string; detail: string | null }[];
  footer: string;
}

/**
 * The layers as an area of a whole: the axis is 0 to 1 in quarters, each layer is stacked on the last, a 1 px line in
 * the layer's colour, each layer fading toward the axis, your layer is the most opaque. A week with no share leaves a gap.
 */
function stackedAreaOption(
  base: Record<string, unknown>,
  tokens: ChartTokens,
  {
    tips,
    boundaries,
    ownId,
    youLabel,
  }: {
    tips: readonly WeekTip[];
    boundaries: readonly ChartBoundary[];
    ownId: string | null;
    youLabel: (name: string) => string;
  },
): Record<string, unknown> {
  const shown = (Array.isArray(base.series) ? base.series : []) as SeriesOption[];
  const categories = (record(base.xAxis).data ?? []) as string[];
  const layers = shown.map((entry) => ({
    ...entry,
    stack: 'share',
    // Smooth bands that fade toward the axis (15-data-visualization.md section 1a); no shadow, so the bands stay apart
    smooth: 0.25,
    showSymbol: false,
    lineStyle: { width: 1.5, color: entry.color },
    areaStyle: {
      color: fadeDown(
        entry.color ?? tokens.other,
        entry.id === ownId ? OWN_OPACITY : OTHER_OPACITY,
        (entry.id === ownId ? OWN_OPACITY : OTHER_OPACITY) * 0.55,
      ),
    },
    // The end labels of the line style do not belong to a stacked band
    endLabel: { show: false },
    emphasis: { focus: 'series' },
  }));
  const formatter = (params: readonly TooltipParam[]): string => {
    const [first] = params;
    const tip = tips[first?.dataIndex ?? -1];
    if (tip === undefined) return tipTitleHtml(first?.axisValueLabel ?? '');
    const rows = [...tip.rows]
      .sort((a, b) => b.value - a.value)
      .flatMap((row) => {
        const entry = shown.find((candidate) => candidate.id === row.seriesId);
        if (entry === undefined) return [];
        const name = entry.id === ownId ? youLabel(entry.name ?? '') : (entry.name ?? '');
        // The counts of each platform of an average are long: a line of their own under the row, wrapped, not cut
        const detail =
          row.detail === null
            ? ''
            : `<div style="max-width:380px;margin:0 0 4px 16px;font-size:12px;line-height:16px;color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(row.detail)}</div>`;
        return [`${tipRowHtml(entry.color ?? tokens.other, name, row.text, tokens)}${detail}`];
      });
    return `${tipTitleHtml(tip.title)}${rows.join('')}<div style="margin-top:4px;color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(tip.footer)}</div>`;
  };
  const boundary = boundaryMarkLines(boundaries, categories, tokens);
  return {
    ...base,
    yAxis: { ...record(base.yAxis), min: 0, max: 1, interval: 0.25 },
    // Six brands with the counts of each platform are taller than the 240 px chart: the tooltip hangs on the page (still kept
    // inside the window by `confine`), not in the chart
    tooltip: { ...record(base.tooltip), formatter, appendToBody: true },
    series: [...layers, ...(boundary === null ? [] : [boundary])],
  };
}

export default function SovOverTimeCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.scopeShareOverTime');
  const platforms = useCardPlatforms();
  const unavailable = useScopeUnavailable(t('title'));
  // The weekly shape without its previous window: this card draws no comparison, so it asks for none
  const read = useOverviewSummary({ ...SHAPE_OPTIONS.weekly, subscribed: live });
  const summary = read.data;
  const set = useTrackedSet(summary);
  const model = useMemo(
    () => weeksModel(summary, set, platforms.codes, platforms.average),
    [summary, set, platforms.codes, platforms.average],
  );
  const ready = model !== null && !isUnreadable(model) ? model : null;
  const points = useMemo(() => ready?.points ?? [], [ready]);
  const brands = useMemo(() => ready?.brands ?? [], [ready]);
  const otherName = t('other');
  const average = platforms.average;

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
  const ownId = brands.find((brand) => brand.slot === 1)?.entity.entityId ?? null;
  /**
   * One brand's share of a week with the brand mentions behind it (D17): "24%, 40 of 160 brand mentions" for one
   * platform, and for All platforms the average with the x of y of each platform that has a share that week (R3).
   * "Other tracked" adds the mentions of the brands it folds.
   */
  const countsOf = useCallback(
    (point: FoldedPoint, seriesId: string): { count: number; list: string } | null => {
      const counts =
        seriesId === OTHER_ID
          ? point.otherCounts
          : (point.entities.find((candidate) => candidate.entityId === seriesId)?.counts ?? null);
      if (!average || counts === null || counts.length === 0) return null;
      const list = formatList(
        counts.map((part) => t('platformCount', { platform: engineLabel(part.code), k: part.k, n: part.n })),
      );
      return { count: counts.length, list };
    },
    [average, t],
  );
  const valueText = useCallback(
    (point: FoldedPoint, seriesId: string, value: number): string => {
      const share = formatShare(value);
      const platforms = countsOf(point, seriesId);
      if (platforms !== null) return t('cellAverage', { value: share, count: platforms.count, counts: platforms.list });
      const entry = point.entities.find((candidate) => candidate.entityId === seriesId);
      const mentions = seriesId === OTHER_ID ? point.otherNumerator : (entry?.numerator ?? null);
      return mentions === null ? share : t('cell', { value: share, k: mentions, answers: point.answers });
    },
    [countsOf, t],
  );
  /** The tooltip row of a brand: its share and, for one platform, its x of y; an average gets its platforms' counts below. */
  const rowOf = useCallback(
    (point: FoldedPoint, seriesId: string, value: number): { text: string; detail: string | null } => {
      const platforms = countsOf(point, seriesId);
      return platforms === null
        ? { text: valueText(point, seriesId, value), detail: null }
        : { text: formatShare(value), detail: t('tipCounts', { counts: platforms.list }) };
    },
    [countsOf, valueText, t],
  );
  const tips = useMemo(
    (): WeekTip[] =>
      points.map((point, index) => {
        const title = weekTitle(point);
        if (point.state === 'none') return { title, rows: [], footer: t('tooltipNone') };
        if (point.state !== 'ok') return { title, rows: [], footer: tooFew(point.answers) };
        return {
          title,
          rows: series.flatMap((entry) => {
            const value = entry.values[index];
            return typeof value === 'number' ? [{ seriesId: entry.id, value, ...rowOf(point, entry.id, value) }] : [];
          }),
          footer: average ? t('tooltipAverage') : t('tooltipAnswersOne', { answers: point.answers }),
        };
      }),
    [points, series, weekTitle, tooFew, rowOf, average, t],
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
      stackedAreaOption(option, tokens, {
        tips,
        boundaries,
        ownId,
        youLabel: (name) => t('you', { name }),
      }),
    [tips, boundaries, ownId, t],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => {
      const point = points[index];
      // Only a week with a share has words here: the Table view and the CSV leave the cell of a week without one to the
      // frame (no value), and the tooltip says why (`n/a` for no brand mention at all, how few for 1 to 3)
      const value = series.find((entry) => entry.id === seriesId)?.values[index];
      return point === undefined || typeof value !== 'number' ? null : valueText(point, seriesId, value);
    },
    [points, series, valueText],
  );

  const summaryText = useMemo((): string => {
    const latest = [...points].reverse().find((point) => point.state === 'ok');
    const value = latest?.entities.find((entry) => entry.entityId === ownId)?.value;
    if (latest === undefined || value === null || value === undefined) return t('summaryNone');
    return t('summary', { date: formatChartDate(latest.weekStart), value: formatShare(value) });
  }, [points, ownId, t]);

  const situation: DataSituation =
    set !== null && !set.entities.some((entity) => entity.role === 'competitor')
      ? { kind: 'no_competitor' }
      : ready !== null && ready.shares.validAnswers === 0
        ? { kind: 'no_answers' }
        : { kind: 'ready' };
  const base = useFrameState({
    subject: t('subject'),
    read,
    previous: null,
    previousEmpty: false,
    engine: null,
    situation,
  });
  const active = base.status === 'ready' || base.status === 'refetching';
  const frame: FrameState =
    platforms.codes.length === 0
      ? { status: 'empty', empty: unavailable }
      : active && isUnreadable(model)
        ? // A good read with no per-brand weekly cells is not an error: say so, keep the place. More than 20 tracked
          // brands is its own reason: the API lists the cells of the first 20 only (backend request 24)
          { status: 'empty', empty: { title: t(`${model.unread}.title`), reason: t(`${model.unread}.reason`) } }
        : active && ready !== null && ready.weeksWithAnswers >= 2 && ready.weeksDrawn === 0
          ? { status: 'empty', empty: { title: t('emptyTitle'), reason: t('emptyReason') } }
          : active && ready !== null && ready.weeksWithAnswers < 2
            ? { status: 'empty', empty: { title: t('needsWeeksTitle'), reason: t('needsWeeksReason') } }
            : base;

  useCardExport(item.id, () => {
    if (ready === null || (frame.status !== 'ready' && frame.status !== 'refetching')) return null;
    return {
      id: item.id,
      header: [
        t('weekColumn'),
        t('exportBrand'),
        t('exportShare'),
        t('exportMentions'),
        t('exportAnswers'),
        t('exportPlatforms'),
        t('exportPooled'),
        t('exportState'),
      ],
      rows: points.flatMap((point, index) =>
        series.map((entry) => {
          const value = entry.values[index];
          const share = point.entities.find((candidate) => candidate.entityId === entry.id);
          const counts = entry.id === OTHER_ID ? point.otherCounts : (share?.counts ?? null);
          const mentions = entry.id === OTHER_ID ? point.otherNumerator : (share?.numerator ?? null);
          // A week with no tracked-brand mention is n/a, and an average has no count of its own: each platform's are listed
          const counted = point.state !== 'none' && counts === null;
          return [
            point.weekStart,
            entry.name,
            typeof value === 'number' ? Math.round(value * 1000) / 10 : null,
            counted ? mentions : null,
            counted ? point.answers : null,
            average && counts !== null
              ? counts
                  .map((part) => t('platformCount', { platform: engineLabel(part.code), k: part.k, n: part.n }))
                  .join('; ')
              : null,
            point.pool !== null && point.pool.weeks > 1 ? `${point.pool.from} to ${point.pool.to}` : null,
            point.state,
          ];
        }),
      ),
    };
  });

  const pooled = points.some((point) => point.pool !== null && point.pool.weeks > 1);
  const used = ready?.shares.used.length ?? 0;
  return (
    <ChartFrame
      kind="line"
      keepHeaderWhenEmpty
      variant="panel"
      title={t('title')}
      meta={ready === null ? null : average ? t('metaAverage', { count: used }) : t('metaOne')}
      info={{ what: t('info.what'), how: t('info.how') }}
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
      menu={{ fileName: t('fileName'), png: true, csv: true }}
      {...frame}
    />
  );
}
