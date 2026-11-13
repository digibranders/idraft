'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { roleOf } from './chart-parts';
import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { entityTotals } from './model/entity-totals';
import { colorSlots } from './model/tracked-set';
import { trimIdleMentions } from './model/trim-weeks';
import type { EngineEntityTotals, EntityFigures, TrackedSet, WeeklyMention, WeeklyMentionPoint } from './model/types';
import { weeklyMention } from './model/weekly-series';
import { useCardEngine } from './parts/card-engine';
import { useFrameState, type DataSituation, type FrameState, type ReadFacts } from './parts/frame-state';
import { TrackedFootnote } from './parts/tracked-footnote';
import { useOverview, useOverviewSummary } from '../../overview-context';
import { useCardMeta } from '../engines/card-meta';
import { useCardExport } from '../engines/use-card-seams';
import { ChartFrame, type ChartNotice } from '@/components/app/chart/chart-frame';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { rateBandOption, type RateBandPoint } from '@/lib/charts/rate-band-chart';
import { rateTipText } from '@/lib/charts/rate-tip';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatDateRange, formatPercent } from '@/lib/format';
import { isDetectableChange, MIN_OBSERVATIONS, wilsonInterval } from '@/lib/stats';

/**
 * CH-06, `ai.competitor_trend`: the weekly mention rate of you and the competitors with the highest mention rate in
 * the window, on one engine (D-5; the catalog text says share of voice, the inventory and W-7 say mention rate). The
 * counts are in every tooltip and every Table cell, a week over fewer than 4 answers is a hollow point that says its
 * answers and no percent, and a week with none is a gap. No band by default: four overlapping bands are unreadable,
 * the Wilson interval is in the tooltip.
 */

const HEIGHT = 240;
const formatRate = (value: number): string => formatPercent(value, { decimals: 0 });

interface DrawnBrand {
  figures: EntityFigures;
  slot: number;
}

interface TrendModel {
  totals: EngineEntityTotals;
  weeks: readonly WeeklyMentionPoint[];
  /** You first, then the top competitors by window mention rate. */
  drawn: readonly DrawnBrand[];
  competitorsTracked: number;
  /** The weeks in which the engine gave any valid answer. */
  weeksWithAnswers: number;
}

/** The brands to draw and the weeks to draw them over; `null` while the summary is absent or has no weekly cells. */
function trendModel(
  summary: PromptsSummary | undefined,
  set: TrackedSet | null,
  engineCode: string,
  competitors: number,
): TrendModel | 'unread' | null {
  if (summary === undefined || set === null) return null;
  const totals = entityTotals(summary, engineCode, set);
  const weekly = weeklyMention(summary, engineCode, set);
  if (totals.status !== 'read' || weekly.status !== 'read') return 'unread';
  const slots = colorSlots(set);
  const slotOf = (figures: EntityFigures): number | undefined => slots.get(figures.entity.entityId);
  const own = totals.entities.find((figures) => figures.entity.role === 'own');
  // Highest window mention rate first, with 4 or more answers; the same rate by name
  const top = totals.entities
    .filter(
      (figures) =>
        figures.entity.role === 'competitor' && figures.mention.state === 'ok' && slotOf(figures) !== undefined,
    )
    .sort((a, b) => (b.mention.value ?? 0) - (a.mention.value ?? 0) || a.entity.name.localeCompare(b.entity.name))
    .slice(0, competitors);
  const drawn = [...(own === undefined ? [] : [own]), ...top].flatMap((figures) => {
    const slot = slotOf(figures);
    return slot === undefined ? [] : [{ figures, slot }];
  });
  const ownId = own?.entity.entityId;
  // The idle weeks at the ends are not drawn (an empty slot on the axis)
  const weeks = trimIdleMentions(weekly.points);
  return {
    totals,
    weeks,
    drawn,
    competitorsTracked: totals.entities.filter((figures) => figures.entity.role === 'competitor').length,
    weeksWithAnswers: weeks.filter((point) => (point.entities.find((entry) => entry.entityId === ownId)?.n ?? 0) > 0)
      .length,
  };
}

/** Where a point is drawn: its rate, or for a thin week the share of its few answers (hollow, with no percent). */
function positionOf(point: WeeklyMention | undefined): number | null {
  if (point === undefined || point.n === 0) return null;
  return point.state === 'ok' ? point.value : point.k / point.n;
}

/** A ceiling a little over the highest point, in tenths, never above 1. */
function ceilingOf(values: readonly (number | null)[]): number {
  const highest = Math.max(0, ...values.filter((value): value is number => value !== null));
  return Math.min(1, Math.max(0.1, Math.ceil(highest * 1.1 * 10) / 10));
}

export default function CompetitorTrendCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.trend');
  const tipWords = useRateTipWords();
  const cardMeta = useCardMeta();
  const { scope } = useOverview();
  const engine = useCardEngine(options);
  const competitors = options.competitors === '5' ? 5 : 3;
  // The weekly shape without its previous window: this card draws no comparison, so it asks for none
  const read = useOverviewSummary({ ...SHAPE_OPTIONS.weekly, subscribed: live });
  const summary = read.data;
  const set = useTrackedSet(summary);
  const model = useMemo(
    () => trendModel(summary, set, engine.code, competitors),
    [summary, set, engine.code, competitors],
  );
  const ready = model !== null && model !== 'unread' ? model : null;

  const tipOf = useCallback(
    (point: WeeklyMention): string =>
      rateTipText(
        {
          value: point.value,
          k: point.k,
          n: point.n,
          band: point.state === 'ok' ? wilsonInterval(point.k, point.n) : null,
          thin: point.state === 'insufficient',
        },
        tipWords,
      ),
    [tipWords],
  );
  const weeks = useMemo(() => ready?.weeks ?? [], [ready]);
  const drawn = useMemo(() => ready?.drawn ?? [], [ready]);
  const points = useMemo((): Record<string, (RateBandPoint | null)[]> => {
    const bySeries: Record<string, (RateBandPoint | null)[]> = {};
    for (const { figures } of drawn) {
      bySeries[figures.entity.entityId] = weeks.map((week) => {
        const point = week.entities.find((entry) => entry.entityId === figures.entity.entityId);
        return point === undefined
          ? null
          : { value: positionOf(point), band: null, thin: point.state === 'insufficient', tip: tipOf(point) };
      });
    }
    return bySeries;
  }, [drawn, weeks, tipOf]);
  const series = useMemo(
    (): CategorySeries[] =>
      drawn.map(({ figures, slot }) => ({
        id: figures.entity.entityId,
        name: figures.entity.name,
        role: roleOf(slot),
        values: (points[figures.entity.entityId] ?? []).map((point) => point?.value ?? null),
      })),
    [drawn, points],
  );
  const categories = useMemo(() => weeks.map((week) => formatChartDate(week.weekStart)), [weeks]);
  const titles = useMemo(
    () =>
      weeks.map((week) =>
        week.pool !== null && week.pool.weeks > 1
          ? t('weekTitlePooled', {
              date: formatChartDate(week.weekStart),
              weeks: week.pool.weeks,
              range: formatDateRange(week.pool.from, week.pool.to),
            })
          : t('weekTitle', { date: formatChartDate(week.weekStart) }),
      ),
    [weeks, t],
  );
  const ceiling = useMemo(
    () => ceilingOf(series.flatMap((entry) => entry.values.map((value) => (typeof value === 'number' ? value : null)))),
    [series],
  );
  const boundaries = useMemo(
    () =>
      (set?.boundaries ?? []).map((boundary) => ({
        at: formatChartDate(boundary.weekStart),
        label: t('boundaryAdded', { name: boundary.name }),
      })),
    [set, t],
  );
  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> =>
      rateBandOption(option, tokens, {
        points,
        titles,
        ceiling,
        boundaries,
        // The band is a little stronger on the dark ground; the theme is a class of the page
        dark: document.documentElement.classList.contains('dark'),
      }),
    [points, titles, ceiling, boundaries],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => points[seriesId]?.[index]?.tip ?? null,
    [points],
  );

  const summaryText = useMemo((): string => {
    if (ready === null) return t('summaryUnknown', { engine: engine.label });
    const own = ready.drawn.find((entry) => entry.figures.entity.role === 'own')?.figures.mention;
    const rival = ready.drawn.find((entry) => entry.figures.entity.role === 'competitor')?.figures;
    if (own === undefined || own.value === null) return t('summaryUnknown', { engine: engine.label });
    const ownText = formatRate(own.value);
    const ownCount = tipWords.answers(own.k, own.n);
    if (rival === undefined || rival.mention.value === null) return t('summaryOwn', { own: ownText, ownCount });
    const detectable = isDetectableChange({ k: rival.mention.k, n: rival.mention.n }, { k: own.k, n: own.n });
    // The gap is of the rounded figures the sentence prints, so it reads as the difference of what is written
    const points = Math.abs(Math.round(rival.mention.value * 100) - Math.round(own.value * 100));
    return `${t('summaryGap', {
      own: ownText,
      ownCount,
      name: rival.entity.name,
      rival: formatRate(rival.mention.value),
      rivalCount: tipWords.answers(rival.mention.k, rival.mention.n),
      points,
    })}${detectable === null ? '' : t(detectable ? 'summaryLarger' : 'summaryWithin')}`;
  }, [ready, engine.label, tipWords, t]);

  const readFacts: ReadFacts =
    model === 'unread' ? { status: 'error', errorId: read.errorId, stale: false, refetch: read.refetch } : read;
  const situation: DataSituation =
    set !== null && !set.entities.some((entity) => entity.role === 'competitor')
      ? { kind: 'no_competitor' }
      : ready !== null && ready.totals.validAnswers === 0
        ? { kind: 'no_answers' }
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
  const notice: ChartNotice | undefined = frame.notice;

  useCardExport(item.id, () => {
    if (ready === null || (frame.status !== 'ready' && frame.status !== 'refetching')) return null;
    return {
      id: item.id,
      header: ['week', 'brand', 'value', 'k', 'n', 'state'],
      rows: weeks.flatMap((week) =>
        drawn.flatMap(({ figures }) => {
          const point = week.entities.find((entry) => entry.entityId === figures.entity.entityId);
          return point === undefined
            ? []
            : [
                [
                  week.weekStart,
                  figures.entity.name,
                  point.value === null ? null : Math.round(point.value * 1000) / 10,
                  point.k,
                  point.n,
                  point.state,
                ],
              ];
        }),
      ),
    };
  });

  const pooled = weeks.some((week) => week.pool !== null && week.pool.weeks > 1);
  const meta =
    summary === undefined || ready === null
      ? null
      : cardMeta({
          range: { from: summary.window.from, to: summary.window.to },
          prompts: summary.total?.prompt_count ?? null,
          answers: ready.totals.validAnswers,
          branded: scope.branded,
          promptWeighted: true,
        });

  return (
    <ChartFrame
      kind="line"
      variant="panel"
      title={t('title', { engine: engine.label })}
      meta={meta}
      notice={notice}
      footnote={
        ready === null || set === null ? null : (
          <>
            <p data-testid="trend-footnote">
              {t('footnoteDrawn', { shown: ready.drawn.length - 1, total: ready.competitorsTracked })}
            </p>
            <p>{t('footnoteThin', { min: MIN_OBSERVATIONS })}</p>
            {pooled ? <p>{t('footnotePooled')}</p> : null}
            <TrackedFootnote set={set} />
          </>
        )
      }
      height={HEIGHT}
      summary={summaryText}
      categories={categories}
      categoryHeader={t('weekColumn')}
      series={series}
      formatValue={formatRate}
      cellText={cellText}
      extendOption={extendOption}
      menu={{ fileName: t('fileName', { engine: engine.code }), png: true, csv: true }}
      {...frame}
    />
  );
}
