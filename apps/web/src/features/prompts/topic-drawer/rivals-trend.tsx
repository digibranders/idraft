'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';

import { useTopicDrawer } from './drawer-context';
import { RateLinesFrame, type RateFrameState, type RateLine } from './rate-lines-frame';
import { useTopicTrend } from './topic-trend-query';
import { Select } from '@/components/ui/select';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import { projectEntitiesQuery } from '@/features/prompts/prompt-queries';
import { averageEntityLines, entityLines, type EntityLine } from '@/features/prompts/topics-by-engine/series-model';
import { useErrorId } from '@/lib/api/use-error-id';
import type { SeriesRole } from '@/lib/charts/category-chart';

/** The competitors drawn against the own brand (N3). */
const TOP_COMPETITORS = 3;

/** The engine choice that averages the engines with equal weight. */
const AVERAGE = 'average';

type PaletteIndex = 2 | 3 | 4 | 5 | 6;
const PALETTE: readonly PaletteIndex[] = [2, 3, 4, 5, 6];
const isPalette = (index: number | null | undefined): index is PaletteIndex =>
  PALETTE.some((candidate) => candidate === index);

/**
 * The chart colour of each line (F15): the own brand is chart 1, a competitor keeps the colour stored for it in the
 * entities (chart 2 to 6), and one with none stored, or one outside that range, takes the first of those colours no
 * competitor holds, in the order of `entities`.
 */
export function rivalRoles(
  entities: readonly { entityId: string; role: 'own' | 'competitor' }[],
  stored: ReadonlyMap<string, number | null>,
): Map<string, SeriesRole> {
  const roles = new Map<string, SeriesRole>();
  const held = new Set<number>();
  for (const { entityId, role } of entities) {
    const index = stored.get(entityId);
    if (role === 'own') roles.set(entityId, { kind: 'brand' });
    else if (isPalette(index)) {
      roles.set(entityId, { kind: 'palette', index });
      held.add(index);
    }
  }
  for (const { entityId, role } of entities) {
    if (role === 'own' || roles.has(entityId)) continue;
    const free = PALETTE.find((index) => !held.has(index));
    roles.set(entityId, free === undefined ? { kind: 'other' } : { kind: 'palette', index: free });
    if (free !== undefined) held.add(free);
  }
  return roles;
}

/**
 * The Visibility trend against competitors section of the topic drawer's Overview (WB-TPE-14, WB-TI-12): the weekly
 * Mention rate of the own brand and of the three competitors named most over the window, from the weekly read of the
 * topic (`filter[term]`, entity cells for each week). It is the average of the engines with equal weight (the choice
 * names how many took part) or one engine. Each competitor keeps the colour stored for it; one with no mention in the
 * window is never drawn. A pooled point says so as the trend by engine does, and a point over too few answers is hollow.
 * The prompts without a topic have no weekly read of competitors, and the section says so.
 */
export function RivalsTrend(): ReactElement {
  const { topicKey, summary, engines, extras } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer.rivals');
  const trendWords = useTranslations('prompts.topicDrawer.trend');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const { scope, range, includeBranded, country } = extras;
  const read = useMemo(() => ({ scope, range, includeBranded, country }), [scope, range, includeBranded, country]);
  const untopiced = topicKey === NO_TOPIC;
  const trend = useTopicTrend(read, topicKey, true, summary);
  const errorId = useErrorId(trend.error);
  const entities = useQuery({ ...projectEntitiesQuery(scope), enabled: !untopiced });
  const [choice, setChoice] = useState<string>(AVERAGE);

  // An engine takes part when its weekly read holds both a series and the entities' cells
  const available = useMemo(
    () =>
      engines.flatMap(({ engine }) => {
        const cells = trend.row?.engines.find((candidate) => candidate.engine_code === engine.engine_code);
        return cells?.series != null && cells.entities != null
          ? [{ code: engine.engine_code, label: engine.label, cells }]
          : [];
      }),
    [engines, trend.row],
  );
  const hasAverage = available.length >= 2;
  const chosen =
    choice !== AVERAGE && available.some((entry) => entry.code === choice)
      ? choice
      : hasAverage
        ? AVERAGE
        : (available[0]?.code ?? AVERAGE);

  const { weeks, lines } = useMemo((): { weeks: string[]; lines: RateLine[] } => {
    const found: EntityLine[] =
      chosen === AVERAGE
        ? averageEntityLines(
            available.map((entry) => entry.cells),
            trend.tracked,
            TOP_COMPETITORS,
          )
        : entityLines(available.find((entry) => entry.code === chosen)?.cells, trend.tracked, TOP_COMPETITORS);
    const stored = new Map((entities.data?.data ?? []).map((entry) => [entry.entity.entity_id, entry.color_index]));
    const roles = rivalRoles(found, stored);
    const weekStarts = [...new Set(found.flatMap((line) => line.points.map((point) => point.weekStart)))].sort();
    return {
      weeks: weekStarts,
      lines: found.map((line) => ({
        id: line.entityId,
        name: line.role === 'own' ? t('own', { name: line.name }) : line.name,
        role: roles.get(line.entityId) ?? { kind: 'other' },
        points: weekStarts.map((week) => line.points.find((point) => point.weekStart === week) ?? null),
      })),
    };
  }, [chosen, available, trend.tracked, entities.data, t]);
  // The own brand alone is no comparison: without a competitor named there is nothing to draw
  const named = lines.some((line) => line.role.kind !== 'brand');
  const noSeries = trend.row === undefined || trend.row.engines.every((cells) => cells.series == null);

  const state: RateFrameState = untopiced
    ? { status: 'empty', empty: { title: t('unavailableTitle'), reason: t('unavailableReason') } }
    : named
      ? { status: trend.fetching ? 'refetching' : 'ready' }
      : trend.status === 'failed'
        ? {
            status: 'error',
            error: {
              title: prompts('summaryLoadFailed'),
              reason: prompts('loadFailedReason'),
              errorId,
              onRetry: trend.retry,
              retrying: trend.fetching,
              retryLabel: common('retry'),
            },
          }
        : trend.status === 'loading'
          ? { status: 'loading' }
          : noSeries
            ? { status: 'empty', empty: { title: trendWords('noSeriesTitle'), reason: trendWords('noSeriesReason') } }
            : { status: 'empty', empty: { title: t('noneTitle'), reason: t('noneReason') } };

  const options = [
    ...(hasAverage ? [{ value: AVERAGE, label: t('engineAverage', { count: available.length }) }] : []),
    ...available.map((entry) => ({ value: entry.code, label: entry.label })),
  ];
  return (
    <RateLinesFrame
      title={t('title')}
      meta={t('meta', { count: TOP_COMPETITORS })}
      summary={t('summary')}
      weeks={weeks}
      lines={lines}
      lastValidAt={trend.row?.last_valid_at ?? null}
      footnote={<p>{t('footnote')}</p>}
      controls={
        options.length > 1 && named ? (
          <div className="w-44 min-w-0">
            <Select<string>
              aria-label={t('engineLabel')}
              size="sm"
              value={chosen}
              onValueChange={setChoice}
              placeholder={t('engineLabel')}
              options={options}
            />
          </div>
        ) : undefined
      }
      state={state}
    />
  );
}
