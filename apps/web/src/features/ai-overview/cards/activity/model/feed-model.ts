import { TZDate } from '@date-fns/tz';

import { collectionStatus, type CollectionStatus } from './collection-status';
import { dayCounts } from './status-model';
import type { CollectionDaily } from '../data/activity-reads';
import type { EngineAggregate, OverviewAggregates, RateCount } from '../../../data/aggregates';
import type { Comparison } from '../../engines/facts-model';
import type { EngineCode, Run } from '@/lib/api/types';
import { rateChange } from '@/lib/compare/change-model';
import { formatIsoDate } from '@/lib/format';

/**
 * What the Key changes feed says (WP-37 plan T7, row WB-OV-10), as data: a row is a kind, the counts of its sentence
 * and where it leads, and the words are the card's. Pure. A change of a rate is a row only when it is larger than
 * normal variation (`rateChange`, `isDetectableChange`): a move within it, or a rate that cannot be told, is never a
 * row and never "fell by 0.4". Unknown is never 0: a count that cannot be told is no row.
 */

export type FeedGroup = 'needs_attention' | 'changes' | 'notices';
export type FeedMetric = 'mention' | 'citation';
/** Why the changes since the window before are not told: the comparison is off, or that window has no valid answer. */
export type Hold = 'off' | 'noPrevious';

/** Where a row leads: the card turns it into a link of the page's scope, or the current view where there is none. */
export type FeedLink =
  { kind: 'prompts'; engine: EngineCode; metric: FeedMetric } | { kind: 'runs' } | { kind: 'newSources' };

/** A rate and the answers behind it: `k` of `n` valid answers. */
export interface RateSide {
  rate: number;
  k: number;
  n: number;
}

interface EntryBase {
  /** Stable for the same row across renders and scopes with the same facts. */
  id: string;
  group: FeedGroup;
  /** The instant the row is dated by, ISO 8601: a run's own time, or the start of the row's business day. */
  at: string;
  /**
   * The business day (`YYYY-MM-DD`, project zone) of a row that is about a day or the whole window, which has no time of
   * its own; `null` for a run, which has one.
   */
  day: string | null;
  link: FeedLink;
}

export type FeedEntry = EntryBase &
  (
    | {
        kind: 'rate';
        engine: EngineCode;
        metric: FeedMetric;
        direction: 'fell' | 'rose';
        /** The rate now minus the rate before, 0 to 1 scale. */
        points: number;
        now: RateSide;
        before: RateSide;
      }
    | {
        kind: 'run';
        status: 'completed' | 'completed_with_errors' | 'failed';
        collected: number;
        failed: number;
        total: number;
      }
    | { kind: 'blocked'; count: number }
    | { kind: 'day'; engine: EngineCode; date: string; refused: number; error: number; answers: number }
    | { kind: 'newSources'; count: number }
  );

export interface FeedInput {
  /** `null` until the summary and the engines are read. */
  aggregates: OverviewAggregates | null;
  /** The engines the card shows, in catalog order. */
  asked: readonly EngineCode[];
  comparison: Comparison;
  /** The newest AI runs; `null` where they are not read. Only the runs made inside the window count. */
  runs: readonly Run[] | null;
  daily: CollectionDaily | undefined;
  /** The domains new in the window (`newSourcesCount`); `null` where that cannot be told. */
  newSources: number | null;
  /** The first and the last day of the window, `YYYY-MM-DD`, in the project's time zone. */
  windowFrom: string;
  windowTo: string;
  timeZone: string;
}

export interface Feed {
  /** In the order the feed ranks them: the most urgent group first. Every row, whatever the card shows of them. */
  entries: readonly FeedEntry[];
  hold: Hold | null;
}

const GROUP_RANK: Readonly<Record<FeedGroup, number>> = { needs_attention: 0, changes: 1, notices: 2 };

const METRICS = [
  { metric: 'mention', cell: 'mentioned' },
  { metric: 'citation', cell: 'cited' },
] as const satisfies readonly { metric: FeedMetric; cell: 'mentioned' | 'cited' }[];

/** The first instant of a business day in the project's zone: where a row about a whole day or window is dated. */
export function startOfBusinessDay(date: string, timeZone: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  // `TZDate.toISOString` writes the zone's own offset; the feed carries UTC instants
  return new Date(new TZDate(year, month - 1, day, 0, 0, 0, 0, timeZone).getTime()).toISOString();
}

function sideOf(figure: { value: number; answers: number; successes: number | null }): RateSide | null {
  return figure.successes === null ? null : { rate: figure.value, k: figure.successes, n: figure.answers };
}

function rateEntry(
  engine: EngineAggregate,
  metric: FeedMetric,
  now: RateCount,
  before: RateCount,
  dating: Pick<EntryBase, 'at' | 'day'>,
): FeedEntry[] {
  const change = rateChange(now, before, metric === 'mention' ? 'mentioned' : 'cited');
  // Only a move larger than normal variation is a row: `null` (no test) and `false` are not
  if (change === null || change.detectable !== true || change.points === 0) return [];
  const nowSide = sideOf(change.now);
  const beforeSide = sideOf(change.before);
  if (nowSide === null || beforeSide === null) return [];
  const fell = change.points < 0;
  return [
    {
      id: `rate:${engine.engineCode}:${metric}`,
      kind: 'rate',
      group: fell ? 'needs_attention' : 'changes',
      ...dating,
      link: { kind: 'prompts', engine: engine.engineCode, metric },
      engine: engine.engineCode,
      metric,
      direction: fell ? 'fell' : 'rose',
      points: change.points,
      now: nowSide,
      before: beforeSide,
    },
  ];
}

function rateEntries(
  aggregates: OverviewAggregates,
  asked: readonly EngineCode[],
  dating: Pick<EntryBase, 'at' | 'day'>,
): FeedEntry[] {
  return asked.flatMap((code) => {
    const engine = aggregates.engines.find((candidate) => candidate.engineCode === code);
    if (engine === undefined || engine.previous === null) return [];
    const earlier = engine.previous;
    return METRICS.flatMap(({ metric, cell }) => rateEntry(engine, metric, engine[cell], earlier[cell], dating));
  });
}

/**
 * The runs made inside the window (first day to last day, in the project's zone) are the only ones the feed looks at:
 * the latest finished one, and the runs a budget blocked after it. So "3 AI runs were blocked" counts the runs of the
 * window, whatever the page shows of a later one.
 */
function runEntries(input: FeedInput): FeedEntry[] {
  const { runs, windowFrom, windowTo, timeZone } = input;
  if (runs === null) return [];
  const inWindow = (run: Run): boolean => {
    const date = formatIsoDate(run.created_at, timeZone);
    return date >= windowFrom && date <= windowTo;
  };
  const collection: CollectionStatus = collectionStatus(runs.filter(inWindow));
  const entries: FeedEntry[] = [];
  const { latest, blocked } = collection;
  if (latest !== null && (latest.status === 'failed' || latest.failed > 0)) {
    entries.push({
      id: `run:${latest.runId}`,
      kind: 'run',
      group: latest.status === 'failed' ? 'needs_attention' : 'notices',
      at: latest.at,
      day: null,
      link: { kind: 'runs' },
      status: latest.status,
      collected: latest.collected,
      failed: latest.failed,
      total: latest.total,
    });
  }
  if (blocked !== null) {
    entries.push({
      id: 'blocked',
      kind: 'blocked',
      group: 'needs_attention',
      at: blocked.latestAt,
      day: null,
      link: { kind: 'runs' },
      count: blocked.count,
    });
  }
  return entries;
}

/** For each asked engine, the latest day of the window with refused or error answers; engines are never pooled. */
function dayEntries(input: FeedInput): FeedEntry[] {
  const { daily, asked, timeZone } = input;
  if (daily === undefined) return [];
  const days = daily.data.map(dayCounts);
  return asked.flatMap((code): FeedEntry[] => {
    const latest = days
      .filter((day) => day.engine === code && day.failures > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latest === undefined) return [];
    return [
      {
        id: `day:${code}:${latest.date}`,
        kind: 'day',
        group: 'notices',
        at: startOfBusinessDay(latest.date, timeZone),
        day: latest.date,
        link: { kind: 'runs' },
        engine: code,
        date: latest.date,
        refused: latest.refused,
        error: latest.error,
        answers: latest.answers,
      },
    ];
  });
}

/** How far a rate moved, in points: what ranks rows that are dated alike. Rows that are not rates have none. */
const magnitude = (entry: FeedEntry): number => (entry.kind === 'rate' ? Math.abs(entry.points) : 0);

/**
 * The feed's own order: the most urgent group first, the newest inside a group, the larger move first among rows
 * dated alike, then by id. The card cuts the list to its Rows option in this order, and the export keeps all of it.
 */
function byUrgency(a: FeedEntry, b: FeedEntry): number {
  const byGroup = GROUP_RANK[a.group] - GROUP_RANK[b.group];
  if (byGroup !== 0) return byGroup;
  const byTime = Date.parse(b.at) - Date.parse(a.at);
  if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
  const byMove = magnitude(b) - magnitude(a);
  if (byMove !== 0) return byMove;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function holdOf({ comparison, aggregates }: FeedInput): Hold | null {
  if (comparison === 'off') return 'off';
  return comparison === 'read' && aggregates?.previousAnswers === 0 ? 'noPrevious' : null;
}

/**
 * The rows of the feed. While the changes are held (the comparison is off, or the window before has no answers) only
 * the collection notices are listed, and `hold` says why the rest is not told. A row about the window as a whole is
 * dated by the window's last day, at the start of that day in the project's zone.
 */
export function buildFeed(input: FeedInput): Feed {
  const hold = holdOf(input);
  const collection = [...runEntries(input), ...dayEntries(input)];
  if (hold !== null) return { entries: collection.sort(byUrgency), hold };
  const dating = { at: startOfBusinessDay(input.windowTo, input.timeZone), day: input.windowTo };
  const changes: FeedEntry[] =
    input.comparison === 'read' && input.aggregates !== null ? rateEntries(input.aggregates, input.asked, dating) : [];
  const sources: FeedEntry[] =
    input.newSources !== null && input.newSources > 0
      ? [
          {
            id: 'new-sources',
            kind: 'newSources',
            group: 'changes',
            ...dating,
            link: { kind: 'newSources' },
            count: input.newSources,
          },
        ]
      : [];
  return { entries: [...changes, ...sources, ...collection].sort(byUrgency), hold: null };
}
