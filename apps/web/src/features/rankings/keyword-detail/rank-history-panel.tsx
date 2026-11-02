'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { chartCompetitors, pageRankHistoryQuery } from './detail-queries';
import { detailStateOf, type DetailKind } from './detail-state';
import { MAX_CHART_COMPETITORS, useDetailUrlState, type ChartLayer } from './detail-url-state';
import { daysBetween } from './detail-window';
import { RankHistoryControls, WindowSelect, type CompetitorChoice } from './rank-history-controls';
import { projectEntitiesQuery, type KeywordDetail, type KeywordScope } from '../keyword-inspector/inspector-queries';
import { SectionError } from '../keyword-inspector/section-error';
import { isHiddenDeepCheck } from '../rank-history/rank-history-model';
import { rankStats } from '../rank-history/rank-stats';
import { useRankHistoryChart } from '../rank-history/use-rank-history-chart';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { EmptyState } from '@/components/app/status/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDecimal, formatInteger } from '@/lib/format';
import { WEEKDAYS } from '@/lib/projects/fields';

export interface RankHistoryPanelProps {
  scope: KeywordScope;
  detail: KeywordDetail;
}

const HEIGHT = 240;

/** Why there is nothing to draw, in the words every panel uses for the keyword's state (Decision 9). */
const REASON_OF: Readonly<Record<DetailKind, 'pending' | 'failed' | 'stale' | 'archived' | 'window'>> = {
  archived: 'archived',
  pending: 'pending',
  failed: 'failed',
  stale: 'stale',
  live: 'window',
};

/**
 * The rank history of the page (24-page-templates.md section 9.4): the same chart as the inspector card
 * (`useRankHistoryChart`), 240 px high, with a window, the competitors drawn and the layers on top. One
 * request per window asks for every competitor, the absolute rank and the events, so no control after the
 * window reads again.
 */
export function RankHistoryPanel({ scope, detail }: RankHistoryPanelProps): ReactElement {
  const t = useTranslations('keywordDetail');
  const rank = useTranslations('rankings.rankHistory');
  const days = useTranslations('common.weekdays');
  const { win, setWin, comp, setComp, show, setShow } = useDetailUrlState();

  const entities = useQuery(projectEntitiesQuery(scope));
  const competitors = useMemo(
    () => chartCompetitors(entities.data?.data ?? [], detail.competitor_overrides),
    [entities.data, detail.competitor_overrides],
  );
  const choices = useMemo(
    (): CompetitorChoice[] =>
      competitors.all
        .filter((entity) => competitors.asked.includes(entity.entity.entity_id))
        .map((entity) => ({
          id: entity.entity.entity_id,
          name: entity.entity.canonical_name,
          colorIndex: entity.color_index,
        })),
    [competitors],
  );
  // No choice in the address: the first five by name. A choice names competitors the history may not hold
  const chosenIds = useMemo(
    () =>
      comp === null
        ? choices.slice(0, MAX_CHART_COMPETITORS).map((choice) => choice.id)
        : [...new Set(comp.filter((id) => choices.some((choice) => choice.id === id)))],
    [comp, choices],
  );
  const chosen = useMemo(
    () => chosenIds.flatMap((id) => choices.filter((choice) => choice.id === id)),
    [chosenIds, choices],
  );

  const history = useQuery({
    ...pageRankHistoryQuery(scope, win, competitors.asked),
    enabled: entities.isSuccess,
    // A new window keeps the card (and the Table view) while it loads, instead of replacing it by a skeleton
    placeholderData: keepPreviousData,
  });
  const shown = history.data?.data.window;
  // The weekday of the project's deep check, 0 being Sunday; left out of the meta line if the API sends none
  const weekday = WEEKDAYS[history.data?.data.deep_check_weekday ?? -1];
  const { state, frame } = useRankHistoryChart(history.data?.data, {
    height: HEIGHT,
    // The days of the history on show, which is the previous window's until the new one has arrived
    ...(shown === undefined ? {} : { days: daysBetween(shown.from, shown.to) }),
    deep: show.includes('deep') ? 'show' : 'hide',
    absolute: show.includes('absolute'),
    competitorIds: chosenIds,
    ...(weekday === undefined ? {} : { metaSuffix: t('history.deepCheck', { weekday: days(weekday) }) }),
  });

  // Nothing to build the card from: the competitors or the history did not load and nothing is cached
  const unloaded =
    entities.data === undefined && entities.isError
      ? entities
      : history.data === undefined && history.isError
        ? history
        : null;
  if (unloaded !== null) {
    return (
      <SectionError
        title={rank('failed')}
        error={unloaded.error}
        onRetry={() => void unloaded.refetch()}
        retrying={unloaded.isFetching}
      />
    );
  }
  if (history.data === undefined) {
    return (
      <div
        role="status"
        aria-label={t('history.loading')}
        aria-busy="true"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <Skeleton shape="block" className="h-72 w-full" />
      </div>
    );
  }
  // A read (the history, or the competitors it is asked for) failed again while the last good one is on show: the chart stays, the error is said above it
  const noticeError = history.isError ? history : entities.isError ? entities : null;
  const notice =
    noticeError !== null ? (
      <SectionError
        title={rank('failed')}
        error={noticeError.error}
        onRetry={() => void noticeError.refetch()}
        retrying={noticeError.isFetching}
      />
    ) : null;

  if (frame === null || state === 'empty') {
    const kind = detailStateOf(detail.state, detail.is_active).kind;
    return (
      <div className="flex flex-col gap-3">
        {notice}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          {kind === 'pending' ? null : (
            <div className="flex">
              <WindowSelect win={win} onWinChange={(next) => void setWin(next)} />
            </div>
          )}
          <EmptyState
            variant="inline"
            title={t('noChecks.title')}
            reason={t(`noChecks.${REASON_OF[kind]}`)}
            headingLevel={2}
          />
        </div>
      </div>
    );
  }

  const data = history.data.data;
  const series = data.series ?? [];
  const own = series.find((entry) => entry.entity.role === 'own') ?? series[0];
  // What the chart shows is what the footnote counts: a deep check that is not drawn is not in its numbers
  const deepHidden = frame.model.deepHidden;
  const drawn = (own?.points ?? []).filter((point) => deepHidden === 0 || !isHiddenDeepCheck(point));
  const stats = rankStats(drawn);
  const toggleLayer = (layer: ChartLayer): void =>
    void setShow(show.includes(layer) ? show.filter((entry) => entry !== layer) : [...show, layer]);

  const statsLine =
    state === 'allFailed'
      ? t('history.statsAllFailed')
      : stats.checks === 0
        ? null
        : stats.ranked === 0
          ? t('history.statsUnranked', { checks: stats.checks })
          : t(deepHidden > 0 ? 'history.statsDrawn' : 'history.stats', {
              best: formatInteger(stats.best),
              worst: formatInteger(stats.worst),
              median: formatDecimal(stats.median, 1),
              // The API's average covers every check, so it is left out when some are not drawn
              average: formatDecimal(data.summary.average_rank?.value, 1),
              ranked: formatInteger(stats.ranked),
              checks: formatInteger(stats.checks),
            });

  const footnote = (
    <>
      {statsLine === null ? null : <p>{statsLine}</p>}
      {deepHidden > 0 ? <p>{rank('deepNote', { count: deepHidden })}</p> : null}
      {competitors.all.length > competitors.asked.length ? (
        <p>
          {t('history.competitors.showing', {
            shown: competitors.asked.length,
            total: competitors.all.length,
          })}
        </p>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {notice}
      <ChartFrame
        title={rank('title')}
        variant="panel"
        meta={frame.meta}
        footnote={footnote}
        controls={
          <RankHistoryControls
            win={win}
            onWinChange={(next) => void setWin(next)}
            competitors={choices}
            chosen={chosen}
            onChosenChange={(ids) => void setComp(ids)}
            layers={show}
            onToggleLayer={toggleLayer}
            deepHidden={deepHidden}
          />
        }
        kind="line"
        categories={frame.categories}
        categoryHeader={frame.categoryHeader}
        series={frame.series}
        formatValue={frame.formatValue}
        height={HEIGHT}
        summary={frame.summary}
        status={history.isPlaceholderData ? 'loading' : 'ready'}
        extendOption={frame.extendOption}
      />
    </div>
  );
}
