'use client';

import { CircleSlash, History, LineChart, ListChecks, Plus, Sparkles, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import {
  engineRole,
  historyEvents,
  POOLED_WEEKS,
  rateCeiling,
  staleEvents,
  staleWindow,
  weeklyHistory,
  type HistoryEvent,
  type WeekPoint,
} from './history-model';
import type { PromptAnswers, PromptCounts } from './inspector-reads';
import { outcomeKey, type DateRange } from './prompt-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { ObservationSummary, ProjectEngine } from '@/lib/api/types';
import { rateBandOption, type RateBandPoint } from '@/lib/charts/rate-band-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import {
  formatChartDate,
  formatDateRange,
  formatInterval,
  formatPercent,
  formatTableDate,
  formatTableDateTime,
} from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The answers the table lists. */
const LAST_ANSWERS = 10;
/** An event is no detectable change of the brand's rate, so no icon carries a colour. */
const EVENT_ICON = { added: Plus, model: Sparkles, stale: CircleSlash } as const satisfies Record<
  HistoryEvent['kind'],
  LucideIcon
>;

const formatRate = (value: number): string => formatPercent(value, { decimals: 0 });

export interface InspectorHistoryProps {
  counts: PromptCounts;
  /** The enabled engines, in order: one line each. */
  engines: readonly ProjectEngine[];
  range: DateRange;
  timeZone: string;
  /** When the prompt was added; `null` until it is read. */
  createdAt: string | null;
  answers: PromptAnswers;
  /** The name of an engine by its code, for engines that are off too. */
  labelOf: (code: string) => string;
  noCountsReason: string;
  onOpenAnswer: ((observationId: string, observedAt: string) => void) | undefined;
}

/**
 * The History tab of the prompt inspector (parity spec G94 to G96): the weekly mention rate of each engine over the
 * window with its 95 percent Wilson band (computed in the browser from each week's counts, from the summary's
 * series: no read of its own), the latest 10 answers, and the events the page can tell (the prompt was added, an
 * engine reports another model). The chart's numbers are also a table that is read to assistive technology.
 */
export function InspectorHistory({
  counts,
  engines,
  range,
  timeZone,
  createdAt,
  answers,
  labelOf,
  noCountsReason,
  onOpenAnswer,
}: InspectorHistoryProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const history = useTranslations('prompts.inspector.history');
  const rate = useTranslations('prompts.rate');
  const common = useTranslations('common');
  const model = useMemo(
    () =>
      weeklyHistory(
        engines.map((engine) => engine.engine.engine_code),
        counts.row?.engines,
      ),
    [engines, counts.row],
  );

  /** The words of one week of one engine: the same in the tooltip and in the table. */
  const weekText = useCallback(
    (point: WeekPoint | null): string => {
      if (point === null || point.value === null) return history('cellNone');
      const values = {
        value: formatRate(point.value),
        basis: rate('basis', { successes: point.k, answers: point.n }),
      };
      if (point.thin) return history('cellThin', values);
      return point.band === null
        ? history('cellPlain', values)
        : history('cell', { ...values, interval: formatInterval(point.band.low, point.band.high) });
    },
    [history, rate],
  );
  /** What each point pools, in words: "4 weeks to Oct 26" (fewer weeks for the first points). */
  const titles = useMemo(
    () =>
      (model?.weeks ?? []).map((week, at) =>
        history('pointTitle', { weeks: Math.min(POOLED_WEEKS, at + 1), date: formatChartDate(week) }),
      ),
    [model, history],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => {
      const point = model?.engines.find((engine) => engine.engineCode === seriesId)?.points[index] ?? null;
      return point === null ? null : weekText(point);
    },
    [model, weekText],
  );
  const bands = useMemo((): Record<string, (RateBandPoint | null)[]> => {
    const bySeries: Record<string, (RateBandPoint | null)[]> = {};
    for (const engine of model?.engines ?? []) {
      bySeries[engine.engineCode] = engine.points.map((point) =>
        point === null ? null : { value: point.value, band: point.band, thin: point.thin, tip: weekText(point) },
      );
    }
    return bySeries;
  }, [model, weekText]);
  const ceiling = rateCeiling(model);
  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> =>
      rateBandOption(option, tokens, {
        points: bands,
        titles,
        ceiling,
        // The band is a little stronger on the dark ground (15 section 4); the theme is a class of the page
        dark: document.documentElement.classList.contains('dark'),
      }),
    [bands, titles, ceiling],
  );

  const chartTitle = history('chartTitle');
  const chartLoading =
    counts.status === 'loading' ? (
      <InspectorSection title={chartTitle} icon={LineChart} status="loading" />
    ) : counts.status === 'failed' ? (
      <InspectorSection
        title={chartTitle}
        icon={LineChart}
        status="error"
        error={
          <InlineError
            title={t('countsFailed')}
            reason={t('loadFailedReason')}
            errorId={counts.errorId}
            onRetry={counts.retry}
            retrying={counts.retrying}
            retryLabel={common('retry')}
          />
        }
      />
    ) : null;
  const chart =
    chartLoading ??
    (model === null || counts.row === undefined ? (
      <InspectorSection
        title={chartTitle}
        icon={LineChart}
        status="empty"
        empty={
          <EmptyState
            variant="inline"
            title={counts.row === undefined ? t('noCounts') : history('noSeriesTitle')}
            reason={noCountsReason}
            headingLevel={3}
          />
        }
      />
    ) : (
      <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
        <ChartFrame
          title={chartTitle}
          variant="inspector"
          meta={formatDateRange(range.from, range.to)}
          footnote={history('chartFootnote', { min: MIN_OBSERVATIONS })}
          kind="line"
          categories={model.weeks.map((week) => formatChartDate(week))}
          categoryHeader={history('weekColumn')}
          cellText={cellText}
          series={model.engines.map((engine) => ({
            id: engine.engineCode,
            name: labelOf(engine.engineCode),
            role: engineRole(engine.engineCode),
            values: engine.points.map((point) => point?.value ?? null),
          }))}
          formatValue={formatRate}
          height={180}
          summary={history('chartSummary', {
            engines: model.engines.map((engine) => labelOf(engine.engineCode)).join(', '),
            from: formatChartDate(model.weeks[0] ?? range.from),
            to: formatChartDate(model.weeks.at(-1) ?? range.to),
          })}
          status="ready"
          extendOption={extendOption}
        />
      </div>
    ));

  const lastRows = answers.rows.slice(0, LAST_ANSWERS);
  const answerColumns: PlainColumn<ObservationSummary>[] = [
    {
      id: 'date',
      header: t('columns.date'),
      cell: (row) => {
        const date = formatTableDateTime(row.observed_at, timeZone);
        return onOpenAnswer === undefined ? (
          <span className="num">{date}</span>
        ) : (
          <Button
            variant="link"
            aria-label={t('openAnswer', { engine: labelOf(row.engine_code), date })}
            onClick={() => onOpenAnswer(row.observation_id, row.observed_at)}
          >
            <span className="num">{date}</span>
          </Button>
        );
      },
    },
    { id: 'engine', header: t('columns.engine'), cell: (row) => labelOf(row.engine_code) },
    { id: 'status', header: t('columns.status'), cell: (row) => t(`statuses.${row.status}`) },
    {
      id: 'outcome',
      header: t('columns.outcome'),
      wrap: true,
      cell: (row) => t(`outcomes.${outcomeKey(row.status, row.facts)}`),
    },
  ];
  // A list that is not read (loading, failed) says nothing of silence: no answers there would read as all engines stale
  const events: HistoryEvent[] =
    createdAt === null
      ? []
      : [
          ...historyEvents(createdAt, answers.rows),
          ...(answers.status === 'ready'
            ? staleEvents(
                engines.map((engine) => engine.engine.engine_code),
                answers.rows,
                staleWindow(range, createdAt, timeZone, new Date()),
                !answers.hasMore,
              )
            : []),
        ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <>
      {chart}
      <InspectorSection
        title={history('latestAnswers')}
        icon={ListChecks}
        status={answers.status === 'ready' && lastRows.length === 0 ? 'empty' : answers.status}
        error={
          <InlineError
            title={t('answersFailed')}
            reason={t('loadFailedReason')}
            errorId={answers.errorId}
            onRetry={answers.retry}
            retrying={answers.retrying}
            retryLabel={common('retry')}
          />
        }
        empty={
          <EmptyState variant="inline" title={t('answersEmpty')} reason={t('answersEmptyReason')} headingLevel={3} />
        }
      >
        {answers.rows.length > LAST_ANSWERS ? (
          <p className="mb-2 type-meta">{history('latestNote', { count: LAST_ANSWERS })}</p>
        ) : null}
        <PlainTable<ObservationSummary>
          caption={t('answersCaption')}
          columns={answerColumns}
          rows={lastRows}
          rowKey={(row) => row.observation_id}
          status="ready"
          errorState={null}
          emptyText={t('answersEmpty')}
        />
      </InspectorSection>
      <InspectorSection
        title={history('events')}
        icon={History}
        status={createdAt === null ? 'loading' : answers.status === 'loading' ? 'loading' : 'ready'}
      >
        <ul aria-label={history('eventsLabel')} className="flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3">
              <span className="w-16 shrink-0 num type-meta">{formatTableDate(event.at, timeZone)}</span>
              <Icon icon={EVENT_ICON[event.kind]} size="default" className="mt-0.5 shrink-0 text-foreground-tertiary" />
              <span className="min-w-0 type-body wrap-anywhere">
                {event.kind === 'added'
                  ? history('eventAdded')
                  : event.kind === 'stale'
                    ? history('eventStale', { engine: labelOf(event.engineCode ?? ''), days: event.days ?? 0 })
                    : history('eventModel', {
                        engine: labelOf(event.engineCode ?? ''),
                        from: event.from ?? '',
                        to: event.to ?? '',
                      })}
              </span>
            </li>
          ))}
        </ul>
      </InspectorSection>
    </>
  );
}
