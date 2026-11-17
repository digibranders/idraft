'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { record, roleOf, type SeriesOption, type TooltipParam } from './chart-parts';
import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { shareAcrossPlatforms, type ScopeShareRead } from './model/scope-share';
import { weeklySharesAcross } from './model/scope-weekly';
import { colorSlots } from './model/tracked-set';
import { trimIdleShares } from './model/trim-weeks';
import type { FoldedPoint, TrackedEntity, TrackedSet, WeeklyPoint } from './model/types';
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
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatDateRange, formatList, formatPercent } from '@/lib/format';
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
  /** The weekly points as read, for the answers of a week. */
  raw: readonly WeeklyPoint[];
  weeksWithAnswers: number;
  weeksDrawn: number;
}

function weeksModel(
  summary: PromptsSummary | undefined,
  set: TrackedSet | null,
  codes: readonly string[],
  average: boolean,
): WeeksModel | 'unread' | null {
  if (summary === undefined || set === null || codes.length === 0) return null;
  const shares = shareAcrossPlatforms(summary, codes, set, average);
  const weekly = weeklySharesAcross(summary, codes, set);
  if (shares.status !== 'read' || weekly.status !== 'read') return 'unread';
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
    raw: drawn,
    weeksWithAnswers: drawn.filter((point) => point.answers > 0).length,
    weeksDrawn: drawn.filter((point) => point.state === 'ok').length,
  };
}

/** What the tooltip of one week says: the shares best first, or why the week has none. */
interface WeekTip {
  title: string;
  rows: readonly { seriesId: string; value: number }[];
  footer: string;
}

/**
 * The layers as an area of a whole: the axis is 0 to 1 in quarters, each layer is stacked on the last, a 1 px line in
 * the surface colour keeps neighbours apart, your layer is the most opaque. A week with no share leaves a gap.
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
    showSymbol: false,
    lineStyle: { width: 1, color: tokens.surfaceElevated },
    areaStyle: { color: entry.color, opacity: entry.id === ownId ? OWN_OPACITY : OTHER_OPACITY },
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
        return [tipRowHtml(entry.color ?? tokens.other, name, formatShare(row.value), tokens)];
      });
    return `${tipTitleHtml(tip.title)}${rows.join('')}<div style="margin-top:4px;color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(tip.footer)}</div>`;
  };
  const boundary = boundaryMarkLines(boundaries, categories, tokens);
  return {
    ...base,
    yAxis: { ...record(base.yAxis), min: 0, max: 1, interval: 0.25 },
    tooltip: { ...record(base.tooltip), formatter },
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
  const ready = model !== null && model !== 'unread' ? model : null;
  const points = useMemo(() => ready?.points ?? [], [ready]);
  const raw = useMemo(() => ready?.raw ?? [], [ready]);
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
  const tips = useMemo(
    (): WeekTip[] =>
      points.map((point, index) => {
        const title = weekTitle(point);
        if (point.state !== 'ok') return { title, rows: [], footer: tooFew(point.answers) };
        return {
          title,
          rows: series.flatMap((entry) => {
            const value = entry.values[index];
            return typeof value === 'number' ? [{ seriesId: entry.id, value }] : [];
          }),
          footer: average ? t('tooltipAverage') : t('tooltipAnswersOne', { answers: point.answers }),
        };
      }),
    [points, series, weekTitle, tooFew, average, t],
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
      if (point === undefined) return null;
      if (point.state !== 'ok') return tooFew(point.answers);
      const value = series.find((entry) => entry.id === seriesId)?.values[index];
      if (typeof value !== 'number') return null;
      if (average) return t('cellAverage', { value: formatShare(value) });
      // One brand's mentions of the week over all tracked-brand mentions; "Other tracked" has no single count
      const mentions = point.entities.find((entry) => entry.entityId === seriesId)?.numerator;
      return mentions === undefined
        ? t('cellNoCount', { value: formatShare(value), answers: point.answers })
        : t('cell', { value: formatShare(value), k: mentions, answers: point.answers });
    },
    [points, series, tooFew, average, t],
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
      : active && model === 'unread'
        ? // A good read with no per-brand weekly cells (backend request 10) is not an error: say so, keep the place
          { status: 'empty', empty: { title: t('notCollected.title'), reason: t('notCollected.reason') } }
        : active && ready !== null && ready.weeksWithAnswers >= 2 && ready.weeksDrawn === 0
          ? { status: 'empty', empty: { title: t('emptyTitle'), reason: t('emptyReason') } }
          : active && ready !== null && ready.weeksWithAnswers < 2
            ? { status: 'empty', empty: { title: t('needsWeeksTitle'), reason: t('needsWeeksReason') } }
            : base;

  useCardExport(item.id, () => {
    if (ready === null || (frame.status !== 'ready' && frame.status !== 'refetching')) return null;
    return {
      id: item.id,
      header: [t('weekColumn'), t('exportBrand'), t('exportShare'), t('exportAnswers'), t('exportState')],
      rows: points.flatMap((point, index) =>
        series.map((entry) => {
          const value = entry.values[index];
          return [
            point.weekStart,
            entry.name,
            typeof value === 'number' ? Math.round(value * 1000) / 10 : null,
            // An average has no single count: each platform's answers are its own
            average ? null : (raw[index]?.answers ?? null),
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
