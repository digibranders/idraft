'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { roleOf } from './chart-parts';
import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { entityTotals } from './model/entity-totals';
import { colorSlots } from './model/tracked-set';
import { trimIdleShares } from './model/trim-weeks';
import type { EngineEntityTotals, EntityFigures, RankedWeek, TrackedSet } from './model/types';
import { rankSeries, weeklyShares } from './model/weekly-series';
import { useCardEngine } from './parts/card-engine';
import { useFrameState, type DataSituation, type FrameState, type ReadFacts } from './parts/frame-state';
import { TrackedFootnote } from './parts/tracked-footnote';
import { rankAxisOption, type RankTip } from './rank-axis';
import { useOverview, useOverviewSummary } from '../../overview-context';
import { useCardMeta } from '../engines/card-meta';
import { useCardExport } from '../engines/use-card-seams';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
import type { ChartBoundary } from '@/lib/charts/boundaries';
import type { CategorySeries } from '@/lib/charts/category-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatInteger, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * CH-29, `ai.sov_rank`: where you and the top brands rank by weekly share of voice on one engine (D-8). A rank of
 * a small weekly sample flips on noise, so the ranks are of the shares as the server pooled them, or else of the
 * trailing four weeks together; equal shares share the lower rank, and a week with fewer than 4 answers naming a
 * tracked brand has no rank at all: a gap, never last place. You and the five brands with the highest share in the
 * window are drawn, and the footnote says how many tracked brands are not.
 */

const HEIGHT = 240;
/** A rank needs this many brands to order. */
const MIN_BRANDS = 3;
const formatShare = (value: number): string => formatPercent(value, { decimals: 0 });

interface DrawnBrand {
  figures: EntityFigures;
  slot: number;
}

interface RankModel {
  totals: EngineEntityTotals;
  weeks: readonly RankedWeek[];
  drawn: readonly DrawnBrand[];
  /** The tracked brands that are not drawn. */
  hidden: number;
  /** The server pooled a point, so the weeks are ranked as read. */
  asRead: boolean;
  weeksWithAnswers: number;
  /** Weeks in which at least one brand has a rank. */
  weeksRanked: number;
}

function rankModel(
  summary: PromptsSummary | undefined,
  set: TrackedSet | null,
  engineCode: string,
): RankModel | 'unread' | null {
  if (summary === undefined || set === null) return null;
  const totals = entityTotals(summary, engineCode, set);
  const weekly = weeklyShares(summary, engineCode, set);
  if (totals.status !== 'read' || weekly.status !== 'read') return 'unread';
  const slots = colorSlots(set);
  const slotOf = (figures: EntityFigures): number | undefined => slots.get(figures.entity.entityId);
  const own = totals.entities.find((figures) => figures.entity.role === 'own');
  // Only a brand with a palette slot is drawn, and the palette has five competitor slots: the colour slots are
  // the cut. The highest window share first; the same share by name
  const top = totals.entities
    .filter(
      (figures) =>
        figures.entity.role === 'competitor' && figures.share.state === 'ok' && slotOf(figures) !== undefined,
    )
    .sort((a, b) => (b.share.value ?? 0) - (a.share.value ?? 0) || a.entity.name.localeCompare(b.entity.name));
  const drawn = [...(own === undefined ? [] : [own]), ...top].flatMap((figures) => {
    const slot = slotOf(figures);
    return slot === undefined ? [] : [{ figures, slot }];
  });
  // Whether the server pooled a point is a fact of the whole series, even of a week that is left off the axis
  const asRead = weekly.points.some((point) => point.pool !== null);
  // The idle weeks at the ends are not drawn (an empty slot on the axis), nor ranked
  const drawnWeeks = trimIdleShares(weekly.points);
  const weeks = rankSeries(drawnWeeks, { asRead });
  return {
    totals,
    weeks,
    drawn,
    hidden: set.entities.length - drawn.length,
    asRead,
    weeksWithAnswers: drawnWeeks.filter((point) => point.answers > 0).length,
    weeksRanked: weeks.filter((week) => week.entities.some((entity) => entity.rank !== null)).length,
  };
}

const rankOf = (week: RankedWeek, entityId: string): number | null =>
  week.entities.find((entity) => entity.entityId === entityId)?.rank ?? null;

export default function SovRankCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.sovRank');
  const cardMeta = useCardMeta();
  const { scope } = useOverview();
  const engine = useCardEngine(options);
  // The weekly shape without its previous window: this card draws no comparison, so it asks for none
  const read = useOverviewSummary({ ...SHAPE_OPTIONS.weekly, subscribed: live });
  const summary = read.data;
  const set = useTrackedSet(summary);
  const model = useMemo(() => rankModel(summary, set, engine.code), [summary, set, engine.code]);
  const ready = model !== null && model !== 'unread' ? model : null;
  const weeks = useMemo(() => ready?.weeks ?? [], [ready]);
  const drawn = useMemo(() => ready?.drawn ?? [], [ready]);

  const rowText = useCallback(
    (rank: number, share: number | null): string => t('row', { rank, share: share === null ? '' : formatShare(share) }),
    [t],
  );
  const categories = useMemo(() => weeks.map((week) => formatChartDate(week.weekStart)), [weeks]);
  const series = useMemo(
    (): CategorySeries[] =>
      drawn.map(({ figures, slot }) => ({
        id: figures.entity.entityId,
        name: figures.entity.name,
        role: roleOf(slot),
        values: weeks.map((week) => rankOf(week, figures.entity.entityId)),
      })),
    [drawn, weeks],
  );
  const shareOf = useCallback(
    (week: RankedWeek, entityId: string): number | null =>
      week.entities.find((entity) => entity.entityId === entityId)?.share ?? null,
    [],
  );
  const tips = useMemo(
    (): RankTip[] =>
      weeks.map((week) => {
        const title = t('weekTitle', { date: formatChartDate(week.weekStart) });
        const rows = drawn.flatMap(({ figures }) => {
          const rank = rankOf(week, figures.entity.entityId);
          return rank === null
            ? []
            : [
                {
                  seriesId: figures.entity.entityId,
                  rank,
                  text: rowText(rank, shareOf(week, figures.entity.entityId)),
                },
              ];
        });
        if (week.entities.every((entity) => entity.rank === null)) {
          return { title, rows, footer: t('footerGap', { answers: week.answers }) };
        }
        return {
          title,
          rows,
          footer:
            week.poolWeeks !== null && week.poolWeeks > 1
              ? t('footerPooled', { answers: week.answers, weeks: week.poolWeeks })
              : t('footerAnswers', { answers: week.answers }),
        };
      }),
    [weeks, drawn, t, rowText, shareOf],
  );
  const boundaries = useMemo(
    (): ChartBoundary[] =>
      (set?.boundaries ?? []).map((boundary) => ({
        at: formatChartDate(boundary.weekStart),
        label: t('boundaryAdded', { name: boundary.name }),
      })),
    [set, t],
  );
  const maxRank = useMemo(
    () =>
      Math.max(
        2,
        ...series.flatMap((entry) => entry.values.filter((value): value is number => typeof value === 'number')),
      ),
    [series],
  );
  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> =>
      rankAxisOption(option, tokens, { maxRank, tips, boundaries }),
    [maxRank, tips, boundaries],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => {
      const week = weeks[index];
      const rank = week === undefined ? null : rankOf(week, seriesId);
      return week === undefined || rank === null ? null : rowText(rank, shareOf(week, seriesId));
    },
    [weeks, rowText, shareOf],
  );

  const summaryText = useMemo((): string => {
    const own = drawn.find((entry) => entry.figures.entity.role === 'own')?.figures.entity;
    // The latest week in which you have a rank, with that rank
    const latest = [...weeks].reverse().flatMap((week) => {
      const rank = own === undefined ? null : rankOf(week, own.entityId);
      return rank === null ? [] : [{ week, rank }];
    })[0];
    if (own === undefined || latest === undefined) return t('summaryNone', { engine: engine.label });
    return t('summary', {
      name: own.name,
      rank: latest.rank,
      count: latest.week.entities.filter((entity) => entity.rank !== null).length,
      engine: engine.label,
      date: formatChartDate(latest.week.weekStart),
    });
  }, [drawn, weeks, engine.label, t]);

  const readFacts: ReadFacts =
    model === 'unread' ? { status: 'error', errorId: read.errorId, stale: false, refetch: read.refetch } : read;
  const situation: DataSituation =
    ready !== null && ready.totals.validAnswers === 0
      ? { kind: 'no_answers' }
      : ready !== null && ready.weeksWithAnswers >= 2 && ready.weeksRanked === 0
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
  const settled = base.status === 'ready' || base.status === 'refetching';
  const frame: FrameState =
    settled && set !== null && set.entities.length < MIN_BRANDS
      ? { status: 'empty', empty: { title: t('needsBrandsTitle'), reason: t('needsBrandsReason') } }
      : settled && ready !== null && ready.weeksRanked < 2
        ? {
            status: 'empty',
            empty: { title: t('needsWeeksTitle'), reason: t('needsWeeksReason', { engine: engine.label }) },
          }
        : base;

  useCardExport(item.id, () => {
    if (ready === null || (frame.status !== 'ready' && frame.status !== 'refetching')) return null;
    return {
      id: item.id,
      header: ['week', 'brand', 'rank', 'share_of_voice', 'answers_naming_tracked'],
      rows: weeks.flatMap((week) =>
        drawn.map(({ figures }) => {
          const share = shareOf(week, figures.entity.entityId);
          return [
            week.weekStart,
            figures.entity.name,
            rankOf(week, figures.entity.entityId),
            share === null ? null : Math.round(share * 1000) / 10,
            week.answers,
          ];
        }),
      ),
    };
  });

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
      kind="line"
      variant="panel"
      title={t('title', { engine: engine.label })}
      meta={meta}
      footnote={
        ready === null || set === null ? null : (
          <>
            <TrackedFootnote set={set} />
            <p>{t(ready.asRead ? 'footnoteAsRead' : 'footnoteTrailing', { min: MIN_OBSERVATIONS })}</p>
            {ready.hidden > 0 ? (
              <p>{t('footnoteHidden', { count: ready.hidden, shown: ready.drawn.length - 1 })}</p>
            ) : null}
          </>
        )
      }
      height={HEIGHT}
      summary={summaryText}
      categories={categories}
      categoryHeader={t('weekColumn')}
      series={series}
      formatValue={formatInteger}
      cellText={cellText}
      extendOption={extendOption}
      menu={{ fileName: t('fileName', { engine: engine.code }), png: true, csv: true }}
      {...frame}
    />
  );
}
