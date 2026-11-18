'use client';

import { Layers, Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { CitationShare } from './data/citation-share';
import { useCitationShare } from './data/use-citation-share';
import { useScopeParts } from './data/use-scope-parts';
import { useEveryPlatformRead, useWeeklyReads, type CompetitorRead } from './data/use-competitor-read';
import { DrawerCard, type DrawerCardState } from './drawer-card';
import { GapCell } from './gap-cell';
import { compareInScope, platformRows, type Figure, type PlatformRow } from './model/comparison';
import { joinTrends, weeklyMentionTrend, type TrendRead } from './model/trend';
import { roleOf } from '../cards/competitors/chart-parts';
import { colorSlots } from '../cards/competitors/model/tracked-set';
import type { TrackedEntity } from '../cards/competitors/model/types';
import type { Read } from '../data/read-state';
import { useOverview } from '../overview-context';
import type { PromptsSummary } from '@/lib/api/types';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { engineLabel } from '@/lib/layouts';
import { formatChartDate, formatList, formatPercent } from '@/lib/format';

/** A value or a label with a tooltip is a tab stop that opens it (20 section 6.2 rule 6); the lint rule cannot see why. */
const TAB_STOP = { tabIndex: 0 } as const;
const HEAD = 'px-3 text-right type-label whitespace-nowrap';
const ROW = 'h-row-compact border-t border-border-subtle';

/** The state of a card from the read it draws: nothing is drawn from a read that has no data. */
function cardState(status: Read<unknown>['status'], errorId: string | null, retry: () => void): DrawerCardState {
  if (status === 'loading') return { status: 'loading' };
  if (status === 'error') return { status: 'error', errorId, retry };
  return { status: 'ready' };
}

function Dot({ slot }: { slot: number | null }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ background: slot === null ? 'var(--chart-other)' : `var(--chart-${String(slot)})` }}
    />
  );
}

/** A rate with the count behind it as a tooltip that the keyboard reaches; "n/a" when the brand has no rate. */
function ValueCell({
  value,
  tip,
  decimals = 0,
  state = 'read',
}: {
  value: number | null;
  tip: string | null;
  decimals?: 0 | 1;
  /** `pending` while the read is under way, `failed` when it could not be read: neither is a rate, and neither is 0. */
  state?: 'read' | 'pending' | 'failed';
}): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  if (state === 'pending') {
    return (
      <td className="px-3 text-right" aria-busy="true">
        <Skeleton shape="text-13" widthPct={56} className="ml-auto" />
        <span className="sr-only">{t('summary.citationPending')}</span>
      </td>
    );
  }
  if (value === null) {
    return (
      <td className="px-3 text-right text-foreground-tertiary">
        {state === 'failed' ? (
          <Tooltip content={t('summary.citationFailed')}>
            <span {...TAB_STOP} className="rounded-xs outline-none focus-visible:focus-ring">
              {t('na')}
              <span className="sr-only">{`, ${t('summary.citationFailed')}`}</span>
            </span>
          </Tooltip>
        ) : (
          t('na')
        )}
      </td>
    );
  }
  const text = formatPercent(value, { decimals });
  return (
    <td className="px-3 text-right num">
      {tip === null ? (
        text
      ) : (
        <Tooltip content={tip}>
          <span {...TAB_STOP} className="rounded-xs outline-none focus-visible:focus-ring">
            {text}
            <span className="sr-only">{`, ${tip}`}</span>
          </span>
        </Tooltip>
      )}
    </td>
  );
}

function SummaryCard({
  read,
  competitor,
  citation,
}: {
  read: CompetitorRead;
  competitor: TrackedEntity;
  citation: Read<CitationShare>;
}): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  const slots = read.set === null ? null : colorSlots(read.set);
  const comparison = useMemo(
    () =>
      read.summary === undefined || read.set === null
        ? null
        : compareInScope(read.summary, read.platforms.codes, read.set, competitor.entityId, read.platforms.average),
    [read.summary, read.set, read.platforms, competitor.entityId],
  );
  const base = cardState(read.status, read.errorId, read.retry);
  // Nothing is compared without a mention rate for both: a brand with under 4 answers is not 0 (R6)
  const state: DrawerCardState =
    base.status !== 'ready'
      ? base
      : comparison === null || comparison.mention.own.value === null || comparison.mention.rival.value === null
        ? { status: 'empty', title: t('summary.emptyTitle'), reason: t('summary.emptyReason') }
        : base;

  const valueTip = (figure: Figure, kind: 'mention' | 'share', platforms: number): string | null => {
    if (read.platforms.average) {
      // An average of platforms has no pooled count: each platform's own counts are named
      const counts = formatList(
        figure.parts.map((part) =>
          t('summary.platformCounts', { name: engineLabel(part.code) ?? part.code, k: part.k, n: part.n }),
        ),
      );
      return counts === ''
        ? t('summary.valueAverage', { count: platforms })
        : t(kind === 'mention' ? 'summary.valueAverageMention' : 'summary.valueAverageShare', {
            count: platforms,
            counts,
          });
    }
    if (figure.answers === null) return null;
    if (figure.successes === null) return null;
    return t(kind === 'mention' ? 'summary.valueMention' : 'summary.valueShare', {
      k: figure.successes,
      n: figure.answers,
    });
  };
  const rows =
    comparison === null
      ? []
      : [
          {
            id: 'mention',
            label: t('summary.mention'),
            tip: t('summary.mentionTip'),
            own: comparison.mention.own,
            rival: comparison.mention.rival,
            ownTip: valueTip(comparison.mention.own, 'mention', comparison.mention.platforms),
            rivalTip: valueTip(comparison.mention.rival, 'mention', comparison.mention.platforms),
            decimals: 0 as const,
            state: 'read' as const,
          },
          {
            id: 'share',
            label: t('summary.share'),
            tip: t('summary.shareTip'),
            own: comparison.share.own,
            rival: comparison.share.rival,
            ownTip: valueTip(comparison.share.own, 'share', comparison.share.platforms),
            rivalTip: valueTip(comparison.share.rival, 'share', comparison.share.platforms),
            decimals: 0 as const,
            state: 'read' as const,
          },
          {
            id: 'citation',
            label: t('summary.citation'),
            tip: t('summary.citationTip'),
            own: {
              value: citation.data?.own ?? null,
              answers: null,
              successes: null,
              parts: [],
              counts: citation.data?.ownCounts ?? null,
            },
            rival: {
              value: citation.data?.rival ?? null,
              answers: null,
              successes: null,
              parts: [],
              counts: citation.data?.rivalCounts ?? null,
            },
            ownTip: null,
            rivalTip: null,
            decimals: 1 as const,
            state:
              citation.status === 'loading'
                ? ('pending' as const)
                : citation.status === 'error'
                  ? ('failed' as const)
                  : ('read' as const),
          },
        ];
  const parts = useScopeParts();
  const separator = useTranslations('inspector')('separator');
  return (
    <DrawerCard
      title={t('summary.title', { name: competitor.name })}
      icon={Scale}
      meta={[parts.platform, parts.group].join(` ${separator} `)}
      info={{ what: t('summary.info.what'), how: t('summary.info.how') }}
      state={state}
      errorTitle={t('errorTitle')}
      flush
    >
      <table aria-label={t('summary.title', { name: competitor.name })} className="w-full type-table">
        <thead>
          <tr className="h-row-header border-t border-border-subtle bg-surface-subtle">
            <th scope="col" className="pr-2 pl-4 text-left type-label">
              {t('summary.measure')}
            </th>
            <th scope="col" className={HEAD}>
              <span className="inline-flex items-center gap-1.5">
                <Dot slot={1} />
                {t('summary.you')}
              </span>
            </th>
            <th scope="col" className={HEAD}>
              <span className="inline-flex items-center gap-1.5">
                <Dot slot={slots?.get(competitor.entityId) ?? null} />
                {competitor.name}
              </span>
            </th>
            <th scope="col" className={`${HEAD} pr-4`}>
              {t('summary.gap')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={ROW}>
              <th scope="row" className="pr-2 pl-4 text-left font-normal whitespace-nowrap text-foreground">
                <Tooltip content={row.tip}>
                  <span {...TAB_STOP} className="rounded-xs outline-none focus-visible:focus-ring">
                    {row.label}
                  </span>
                </Tooltip>
              </th>
              <ValueCell value={row.own.value} tip={row.ownTip} decimals={row.decimals} state={row.state} />
              <ValueCell value={row.rival.value} tip={row.rivalTip} decimals={row.decimals} state={row.state} />
              <td className="px-3 pr-4 text-right">
                <GapCell
                  own={row.own.value}
                  rival={row.rival.value}
                  ownCounts={row.own.counts}
                  rivalCounts={row.rival.counts}
                  name={competitor.name}
                  decimals={row.decimals}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DrawerCard>
  );
}

/** The series and the words of the trend card from its read. */
function TrendCard({
  read,
  competitor,
  trend,
  weekly,
}: {
  read: CompetitorRead;
  competitor: TrackedEntity;
  trend: TrendRead | null;
  weekly: Read<unknown>;
}): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  const status = useTranslations('status.error');
  const common = useTranslations('common');
  const { scope } = useOverview();
  const errorId = weekly.errorId;
  const slot = read.set === null ? undefined : colorSlots(read.set).get(competitor.entityId);
  const weeks = useMemo(() => (trend?.status === 'read' ? trend.weeks : []), [trend]);
  const categories = useMemo(() => weeks.map((week) => formatChartDate(week.weekStart)), [weeks]);
  const series = useMemo(
    () => [
      { id: 'you', name: t('summary.you'), role: roleOf(1), values: weeks.map((week) => week.own.value) },
      {
        id: competitor.entityId,
        name: competitor.name,
        role: roleOf(slot ?? 0),
        values: weeks.map((week) => week.rival.value),
      },
    ],
    [weeks, competitor, slot, t],
  );
  const base = {
    kind: 'line' as const,
    variant: 'inspector' as const,
    title: t('trend.title'),
    meta: t('trend.meta'),
    info: {
      what: t('trend.info.what'),
      how: t('trend.info.how', { days: scope.range.days, weeks: weeks.length, compare: String(scope.compare) }),
    },
    height: 180 as const,
    summary: t('trend.label', { name: competitor.name, count: weeks.length }),
    categories,
    categoryHeader: t('trend.weekColumn'),
    series,
    formatValue: (value: number): string => formatPercent(value, { decimals: 0 }),
    cellText: (seriesId: string, index: number): string | null => {
      const week = weeks[index];
      const point = week === undefined ? undefined : seriesId === 'you' ? week.own : week.rival;
      if (point === undefined || point.value === null) return null;
      const value = formatPercent(point.value, { decimals: 0 });
      return point.answers === null ? value : t('trend.pointTip', { value, count: point.answers });
    },
  };
  let frame: Parameters<typeof ChartFrame>[0];
  if (weekly.status === 'loading' || read.status === 'loading') {
    frame = { ...base, status: 'loading' };
  } else if (weekly.status === 'error') {
    frame = {
      ...base,
      status: 'error',
      error: {
        title: t('errorTitle'),
        reason: t('errorReason'),
        errorId:
          errorId === null
            ? null
            : {
                id: errorId,
                label: status('errorId', { id: errorId }),
                copyLabel: status('copyErrorId'),
                copiedLabel: status('copied'),
              },
        onRetry: weekly.refetch,
        retrying: false,
        retryLabel: common('retry'),
      },
    };
  } else if (trend === null || trend.status !== 'read') {
    // The weekly read carries no cell for the competitor: a line would be invented, so none is drawn (OV-NOPORT-02)
    frame = {
      ...base,
      status: 'empty',
      empty: { title: t('notCollectedTitle'), reason: t('trend.notCollectedReason', { name: competitor.name }) },
    };
  } else if (trend.weeks.filter((week) => week.own.value !== null && week.rival.value !== null).length < 2) {
    frame = { ...base, status: 'empty', empty: { title: t('trend.emptyTitle'), reason: t('trend.emptyReason') } };
  } else {
    frame = { ...base, status: weekly.status === 'refetching' ? 'refetching' : 'ready' };
  }
  return (
    <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame {...frame} />
    </div>
  );
}

function PlatformsCard({
  competitor,
  rows,
  read,
}: {
  competitor: TrackedEntity;
  rows: PlatformRow[];
  read: Read<unknown>;
}): ReactElement {
  const t = useTranslations('aiOverview.competitorDrawer');
  const base = cardState(read.status, read.errorId, read.refetch);
  const state: DrawerCardState =
    base.status === 'ready' && rows.length === 0
      ? { status: 'empty', title: t('platforms.emptyTitle'), reason: t('platforms.empty') }
      : base;
  return (
    <DrawerCard
      title={t('platforms.title')}
      icon={Layers}
      meta={t('platforms.meta')}
      info={{ what: t('platforms.info.what'), how: t('platforms.info.how') }}
      state={state}
      errorTitle={t('errorTitle')}
      flush
    >
      <table aria-label={t('platforms.caption', { name: competitor.name })} className="w-full type-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.code} className="h-row-compact border-t border-border-subtle first:border-t-0">
              <th scope="row" className="pr-2 pl-4 text-left font-normal">
                <EngineLogo engine={row.code} name={engineLabel(row.code)} />
              </th>
              <ValueCell value={row.own} tip={null} />
              <ValueCell value={row.rival} tip={null} />
              <td className="px-3 pr-4 text-right">
                <GapCell
                  own={row.own}
                  rival={row.rival}
                  ownCounts={row.ownCounts}
                  rivalCounts={row.rivalCounts}
                  name={competitor.name}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DrawerCard>
  );
}

/** The Overview tab (OV-DRW-10 to OV-DRW-13): you against the competitor, over time, and platform by platform. */
export function OverviewTab({ read, competitor }: { read: CompetitorRead; competitor: TrackedEntity }): ReactElement {
  const ownId = read.set?.entities.find((entity) => entity.role === 'own')?.entityId;
  const citation = useCitationShare(ownId, competitor.entityId, true);
  const { current: weekly, previous: weeklyBefore } = useWeeklyReads(true);
  const every = useEveryPlatformRead(true);
  const { set, platforms } = read;
  const trend = useMemo((): TrendRead | null => {
    if (weekly.data === undefined || set === null) return null;
    const trendOf = (summary: PromptsSummary): TrendRead =>
      weeklyMentionTrend(summary, platforms.codes, set, competitor.entityId, platforms.average);
    return joinTrends(weeklyBefore === null ? null : trendOf(weeklyBefore), trendOf(weekly.data));
  }, [weekly.data, weeklyBefore, set, platforms, competitor.entityId]);
  const everyData = every.read.data;
  const rows = useMemo(
    () =>
      everyData === undefined || set === null ? [] : platformRows(everyData, every.codes, set, competitor.entityId),
    [everyData, every.codes, set, competitor.entityId],
  );
  return (
    <>
      <SummaryCard read={read} competitor={competitor} citation={citation} />
      <TrendCard read={read} competitor={competitor} trend={trend} weekly={weekly} />
      <PlatformsCard competitor={competitor} rows={rows} read={every.read} />
    </>
  );
}
