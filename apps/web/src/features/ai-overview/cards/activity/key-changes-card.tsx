'use client';

import { Ban, CircleAlert, Globe, TrendingDown, TrendingUp, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useAiRuns, useCollectionDaily } from './data/activity-reads';
import { buildFeed, type FeedEntry, type FeedLink } from './model/feed-model';
import { useErrorState, useStaleNotice } from './parts/frame-state';
import { comparisonWindow } from '../../data/overview-queries';
import type { Comparison } from '../engines/facts-model';
import { engineLabel } from '../engines/engine-role';
import { useCardData } from '../engines/use-card-data';
import { useCardDrill, useCardExport } from '../engines/use-card-seams';
import { useSourceChanges } from '../sources/data/source-reads';
import { newSourcesCount } from '../sources/model/changes-model';
import { useCitationsDrill } from '../sources/parts/drill';
import { ChangeFeed, type ChangeFeedState } from '@/components/app/feed/change-feed';
import type { ChangeFeedItem } from '@/components/app/feed/feed-model';
import type { ChartNotice } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import type { CsvCell } from '@/lib/csv/csv-write';
import {
  formatBusinessDate,
  formatInteger,
  formatList,
  formatPercent,
  formatTableDateTime,
  type MetricDeltaInput,
} from '@/lib/format';

const ROWS = { '5': 5, '8': 8 } as const;
const DEFAULT_ROWS = 8;

const GLYPH: Readonly<Record<FeedEntry['kind'], LucideIcon>> = {
  rate: TrendingUp,
  run: TriangleAlert,
  blocked: Ban,
  day: CircleAlert,
  newSources: Globe,
};

const GROUP_WORD = {
  needs_attention: 'groupNeedsAttention',
  changes: 'groupChanges',
  notices: 'groupNotices',
} as const satisfies Record<FeedEntry['group'], string>;

/** The most rows the card shows, from its Rows option. */
function rowLimit(option: string | undefined): number {
  return option === '5' || option === '8' ? ROWS[option] : DEFAULT_ROWS;
}

/** The move of a rate on the row: detectable by construction, since only a detectable move is a row. */
const deltaOf = (points: number): MetricDeltaInput => ({
  value: points,
  unit: 'points',
  polarity: 'higher_is_better',
  isDetectable: true,
});

/**
 * WB-OV-10: what changed in the window, in `ChangeFeed` alone (the part draws its own frame and title). A detectable
 * fall of an engine's mention or citation rate needs attention and a rise is a change, each with the counts of both
 * windows; a move within normal variation is never a row. Collection problems (failed answers of the latest run,
 * runs the budget blocked, the latest day with refused or failed answers) are notices, and the domains cited for
 * the first time are one row. With the comparison off, or no answers in the window before, only the collection
 * notices are listed and a banner says why. A read that could not be made is named in the notice and the rest is
 * shown; without access to runs no run row is made.
 */
export default function KeyChangesCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.activity.keyChanges');
  const drill = useCardDrill();
  const citations = useCitationsDrill();
  const data = useCardData({ previous: 'optional', subscribed: live });
  const runs = useAiRuns({ subscribed: live });
  const daily = useCollectionDaily({ subscribed: live });
  // Only the count of the new domains is needed: the list of the lost ones is not asked for
  const changes = useSourceChanges({ limit: 1, lost: false, subscribed: live });
  const { scope, project, asked, canViewRuns } = data;
  const timeZone = project.timeZone;

  const comparison: Comparison =
    comparisonWindow(scope) === null ? 'off' : data.comparing ? 'read' : data.partialPrevious ? 'unread' : 'pending';
  const newCount = newSourcesCount(changes.newer.data, changes.before?.data ?? null);
  const feed = useMemo(
    () =>
      buildFeed({
        aggregates: data.aggregates,
        asked,
        comparison,
        runs: runs.data ?? null,
        daily: daily.data,
        newSources: newCount,
        windowFrom: scope.range.from,
        windowTo: scope.range.to,
        timeZone,
      }),
    [data.aggregates, asked, comparison, runs.data, daily.data, newCount, scope.range.from, scope.range.to, timeZone],
  );
  // The cut is made in the feed's own order (most urgent first, then the larger move); the export lists every row
  const limit = rowLimit(options.rows);
  const shownEntries = feed.entries.slice(0, limit);
  const hidden = feed.entries.length - shownEntries.length;

  const reads = [data, runs, daily, changes.newer, ...(changes.before === null ? [] : [changes.before])];
  // The window before is still on its way only while there is a summary to pair it with (not for no engine or an error)
  const awaitingBefore = comparison === 'pending' && (data.phase === 'ready' || data.phase === 'refetching');
  const loading =
    data.phase === 'loading' ||
    awaitingBefore ||
    [runs, daily, changes.newer, changes.before].some((read) => read?.status === 'loading');
  const refetching =
    data.phase === 'refetching' ||
    [runs, daily, changes.newer, changes.before].some((read) => read?.status === 'refetching');
  // Nothing at all could be read: the reads that gate no row of their own are the card's own error
  const failed =
    data.phase === 'error' && runs.data === undefined && daily.data === undefined && changes.newer.data === undefined;
  const errorId = reads.map((read) => read.errorId).find((id) => id !== null) ?? null;
  const retry = (): void => {
    data.retry();
    runs.refetch();
    daily.refetch();
    changes.newer.refetch();
    changes.before?.refetch();
  };
  const error = useErrorState({ errorId, stale: false, refetch: retry }, t('subject'));
  const staleNotice = useStaleNotice(
    data.stale || runs.stale || daily.stale || changes.newer.stale || changes.before?.stale === true,
  );

  const unchecked: string[] = [];
  if (comparison === 'unread' || (data.phase === 'error' && !failed)) unchecked.push(t('partComparison'));
  if (!canViewRuns) unchecked.push(t('partRunsNoAccess'));
  else if (runs.status === 'error') unchecked.push(t('partRuns'));
  if (daily.status === 'error') unchecked.push(t('partDaily'));
  const newSourcesUnread =
    changes.newer.status === 'error' ||
    changes.before?.status === 'error' ||
    (feed.hold === null && asked.length > 0 && newCount === null && changes.newer.status !== 'loading');
  if (newSourcesUnread) unchecked.push(t('partNewSources'));
  // One notice says every qualifier at once, so a read that failed is named even when the figures are also stale
  const notes = [
    staleNotice?.text,
    unchecked.length === 0 ? undefined : t('notChecked', { parts: formatList(unchecked) }),
    hidden > 0 ? t('moreRows', { count: hidden, shown: formatInteger(hidden) }) : undefined,
  ].filter((text): text is string => text !== undefined);
  const notice: ChartNotice | undefined =
    notes.length === 0 ? undefined : { kind: staleNotice === undefined ? 'partial' : 'stale', text: notes.join('. ') };

  const holdText =
    feed.hold === 'off'
      ? t('holdOff')
      : feed.hold === 'noPrevious'
        ? t('holdNoPrevious')
        : asked.length === 0 && data.engines.data !== undefined
          ? t('holdNoEngine')
          : undefined;

  const name = (code: string): string => engineLabel(code) ?? code;
  const when = (instant: string): string => formatTableDateTime(instant, timeZone);
  // The row says the counts first and the percent after, to fit a line; the export says the whole change in words
  const sentenceOf = (entry: FeedEntry, full = false): string => {
    switch (entry.kind) {
      case 'rate':
        return t(full ? 'rateFull' : 'rate', {
          engine: name(entry.engine),
          metric: entry.metric,
          direction: entry.direction,
          rate: formatPercent(entry.now.rate),
          k: formatInteger(entry.now.k),
          n: formatInteger(entry.now.n),
          beforeRate: formatPercent(entry.before.rate),
          beforeK: formatInteger(entry.before.k),
          beforeN: formatInteger(entry.before.n),
        });
      case 'run':
        return t(entry.status === 'failed' ? 'runFailed' : 'runErrors', {
          date: when(entry.at),
          failed: formatInteger(entry.failed),
          total: formatInteger(entry.total),
        });
      case 'blocked':
        return t('blocked', { count: entry.count, shown: formatInteger(entry.count), date: when(entry.at) });
      case 'day':
        return t('day', {
          engine: name(entry.engine),
          date: formatBusinessDate(entry.date, { withYear: false }),
          failed: formatInteger(entry.refused + entry.error),
          answers: formatInteger(entry.answers),
          refused: formatInteger(entry.refused),
          error: entry.error,
          errors: formatInteger(entry.error),
        });
      case 'newSources':
        return t('newSources', { count: entry.count, shown: formatInteger(entry.count) });
    }
  };

  // A destination that cannot show the scope has no page to open: that row has no link and reads as plain text
  const hrefOf = (link: FeedLink): Route | null => {
    switch (link.kind) {
      case 'prompts':
        return drill('prompts', { engine: link.engine, metric: link.metric });
      case 'runs':
        return drill('runs');
      case 'newSources':
        return citations({ tab: 'new-lost', kind: 'new' });
    }
  };
  // A row about the whole window has no time of its own: it says the window instead of "just now"
  const windowLabel = t('windowLabel', { days: scope.range.days, shown: formatInteger(scope.range.days) });
  const items: ChangeFeedItem[] = shownEntries.map((entry) => {
    const href = hrefOf(entry.link);
    return {
      id: entry.id,
      group: entry.group,
      glyph: entry.kind === 'rate' && entry.direction === 'fell' ? TrendingDown : GLYPH[entry.kind],
      text: sentenceOf(entry),
      at: entry.at,
      ...(href === null ? {} : { href }),
      ...(entry.kind === 'rate' || entry.kind === 'newSources' ? { atLabel: windowLabel } : {}),
      ...(entry.kind === 'rate' ? { change: { kind: 'metric' as const, input: deltaOf(entry.points) } } : {}),
    };
  });

  const state: ChangeFeedState = loading
    ? { status: 'loading' }
    : failed
      ? { status: 'error', error }
      : { status: refetching ? 'refetching' : 'ready', items, total: items.length };

  useCardExport(item.id, () => {
    if (state.status !== 'ready' && state.status !== 'refetching') return null;
    return {
      id: item.id,
      header: [
        t('headerGroup'),
        t('headerChange'),
        t('headerEngine'),
        t('headerCount'),
        t('headerOf'),
        t('headerWhen'),
      ],
      rows: feed.entries.map((entry): CsvCell[] => {
        const [engine, count, outOf] = figuresOf(entry);
        return [
          t(GROUP_WORD[entry.group]),
          sentenceOf(entry, true),
          engine === null ? null : name(engine),
          count,
          outOf,
          // A row about a day or the whole window is dated by that day, not by a time it has none of
          entry.day ?? entry.at,
        ];
      }),
    };
  });

  return (
    <ChangeFeed
      title={t('title')}
      state={state}
      windowText={t('window', { days: scope.range.days, shown: formatInteger(scope.range.days) })}
      notice={notice}
      holdText={holdText}
      timeZone={timeZone}
      max={limit}
    />
  );
}

/** The engine, the count and what it is out of, for the export: the numbers the sentence states. */
function figuresOf(entry: FeedEntry): readonly [engine: string | null, count: number, outOf: number | null] {
  switch (entry.kind) {
    case 'rate':
      return [entry.engine, entry.now.k, entry.now.n];
    case 'run':
      return [null, entry.failed, entry.total];
    case 'blocked':
      return [null, entry.count, null];
    case 'day':
      return [entry.engine, entry.refused + entry.error, entry.answers];
    case 'newSources':
      return [null, entry.count, null];
  }
}
