'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';

import { bestWorst, engineGapOf, engineValue, type EngineValue } from './engine-values';
import { leaderOn, type EntityLeader } from './leaders';
import { enginePoints, poolNote } from './series-model';
import type { EntityRead } from './topic-entities-query';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { InsufficientPill } from '@/components/app/metric/insufficient-pill';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import { Button } from '@/components/ui/button';
import { useEngineColumns } from '@/features/prompts/prompt-columns';
import { CELL_OF_METRIC, type RateMetric } from '@/features/prompts/prompt-model';
import { useEngineRateColumns } from '@/features/prompts/rate-columns';
import { useRateWords } from '@/features/prompts/rate-view';
import type { EngineSummary, MetricCell, ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatBusinessDate, formatDecimal, formatList, formatPercent } from '@/lib/format';
import { cellFigure, validAnswers } from '@/lib/rates/rate-model';
import { MIN_OBSERVATIONS } from '@/lib/stats';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';

/**
 * The columns of the By engine view of the Topics tab (WB-TPE-02 to 08 and 15): per engine the chosen metric as a percent
 * with the count behind it, the engine gap, and, waiting in the column chooser, the per engine counts, trend and leader.
 * The same columns serve the prompt rows under an open topic. A topic's engine cell opens the drawer on its Prompts tab
 * filtered to that engine. The engines are never pooled here: each column is one engine.
 */

/** A rate is drawn on a span of at least 20 points, so a move of a point or two stays flat (as the Trend column does). */
const RATE_MIN_SPAN = 0.2;
const TREND_WIDTH = 96;
const GAP_WIDTH = 120;

export interface ByEngineOptions<TRow> {
  engines: readonly ProjectEngine[];
  /** Must keep its identity between renders (a module level function): the table keys its work by the columns. */
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined;
  /** The topic a row is, or `null` for a prompt row (its engine cells are plain text). Module level as well. */
  topicOf: (row: TRow) => { key: string; name: string } | null;
  entities: EntityRead;
  metric: RateMetric;
  /** Opens the topic's prompts on the engine. */
  onDrill: (topicKey: string, engineCode: string) => void;
}

function Missing({ label }: { label: string }): ReactElement {
  return <span className="text-foreground-tertiary">{label}</span>;
}

/** One engine's weekly line of a topic row, drawn again only when the row's cells change. */
function EngineTrendCell({
  cells,
  code,
  metric,
  engine,
}: {
  cells: readonly EngineSummary[] | undefined;
  code: string;
  metric: RateMetric;
  engine: string;
}): ReactElement | null {
  const t = useTranslations('prompts');
  const locale = useLocale();
  const shown = useMemo(() => {
    const points = enginePoints(
      cells?.find((cell) => cell.engine_code === code),
      CELL_OF_METRIC[metric],
    );
    if (points === null) return null;
    // A point over too few answers is no rate: the line leaves a gap there
    const values = points.map((point) => (point.thin ? null : point.value));
    const params = { metric: t(`metric.${metric}`), engine };
    return {
      values,
      label: values.some((value) => value !== null)
        ? t('topicDrawer.byEngineView.trendLabel', {
            ...params,
            rates: formatList(
              values.map((value) => (value === null ? t('columns.trendGap') : formatPercent(value, { decimals: 0 }))),
              locale,
            ),
          })
        : t('topicDrawer.byEngineView.trendLabelNone', params),
    };
  }, [cells, code, metric, engine, t, locale]);
  // Never red or green: the line is the reference gray, and the words say how it went
  return shown === null ? null : (
    <SparklineCell values={shown.values} label={shown.label} tone="reference" minSpan={RATE_MIN_SPAN} />
  );
}

/**
 * The columns, in order: each engine's rate of the chosen metric (shown), the engine gap (shown), then, waiting in the
 * column chooser, each engine's Mentioned and Cited counts, its Trend and the Leader on it.
 */
export function useByEngineColumns<TRow>({
  engines,
  cellsOf,
  topicOf,
  entities,
  metric,
  onDrill,
}: ByEngineOptions<TRow>): DataTableColumn<TRow>[] {
  const t = useTranslations('prompts');
  const view = useTranslations('prompts.topicDrawer.byEngineView');
  const compare = useTranslations('prompts.topicDrawer.compare');
  const pooling = useTranslations('prompts.topicDrawer.pooling');
  const locale = useLocale();
  const words = useRateWords();
  const rateColumns = useEngineRateColumns(engines, cellsOf, metric);
  const countColumns = useEngineColumns(engines, cellsOf, {
    sortable: true,
    note: t('topics.weighted'),
    defaultVisible: false,
  });
  // The latest handler, so the columns do not change with every render
  const latestDrill = useRef(onDrill);
  useEffect(() => {
    latestDrill.current = onDrill;
  }, [onDrill]);
  const { status: entityStatus, rows: entityRows, tracked } = entities;

  return useMemo((): DataTableColumn<TRow>[] => {
    const key = CELL_OF_METRIC[metric];
    const labelOf = (code: string): string =>
      engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;
    const summaryOf = (row: TRow, code: string): EngineSummary | undefined =>
      cellsOf(row)?.find((cell) => cell.engine_code === code);
    const percent = (value: number | null): string =>
      value === null ? EMPTY_VALUE : formatPercent(value, { decimals: 0 });
    const shareText = (cell: MetricCell | null): string => percent(cell?.value ?? null);

    /** The leader of an engine of a topic row; `null` for a prompt row, and while the entities are not read. */
    const leaderOf = (row: TRow, code: string): { leader: EntityLeader; answers: number } | null => {
      const topic = topicOf(row);
      if (topic === null || entityStatus !== 'ready') return null;
      const engine = entityRows.get(topic.key)?.engines.find((cell) => cell.engine_code === code);
      return {
        leader: leaderOn(engine, tracked),
        answers: engine === undefined ? 0 : validAnswers(engine.share_of_voice),
      };
    };
    const leaderSentence = (row: TRow, code: string): CellTip | null => {
      const found = leaderOf(row, code);
      if (found === null || found.leader.state !== 'leader' || found.leader.name === null) return null;
      const { leader, answers } = found;
      return {
        content: view('leaderTip', {
          name: leader.name ?? '',
          share: shareText(leader.share),
          engine: labelOf(code),
          answers,
          own: shareText(leader.own),
        }),
        ...(leader.tiedWith.length === 0
          ? {}
          : { detail: view('leaderTied', { others: formatList(leader.tiedWith, locale) }) }),
      };
    };

    // The engine rate columns: a topic's cell opens its prompts on the engine
    const rates = rateColumns.map((column, index): DataTableColumn<TRow> => {
      const code = engines[index]?.engine.engine_code ?? '';
      const label = labelOf(code);
      const figureOf = (row: TRow): ReturnType<typeof cellFigure> => cellFigure(summaryOf(row, code), key);
      return {
        ...column,
        hasControls: true,
        // The button's name says where it goes; the cell is still named by its value
        cellLabel: (row) => {
          const figure = figureOf(row);
          if (figure.state === 'none') return words.reason(figure) ?? EMPTY_VALUE;
          const basis = words.basis(figure);
          return basis === null ? words.text(figure) : view('cellName', { value: words.text(figure), basis });
        },
        cell: (row) => {
          const topic = topicOf(row);
          const content = column.cell(row);
          // A prompt row, and an engine with no answer to open, are plain text
          if (topic === null || figureOf(row).state === 'none') return content;
          return (
            <Button
              {...CELL_CONTROL}
              variant="link"
              size="sm"
              aria-label={view('drillLabel', { topic: topic.name, engine: label })}
              className="max-w-full min-w-0 justify-start text-foreground"
              onClick={() => latestDrill.current(topic.key, code)}
            >
              {content}
            </Button>
          );
        },
        cellTip: (row) => {
          const base = column.cellTip?.(row);
          const leader = leaderSentence(row, code);
          if (leader === null) return base;
          return base === undefined ? leader : { ...base, detail: base.detail ?? leader.content };
        },
      };
    });

    // The engine gap: best minus weakest, over the engines that have a rate
    const valuesOf = (row: TRow): EngineValue[] =>
      engines.map((engine) => engineValue(cellsOf(row), engine.engine.engine_code, key));
    const gapTip = (row: TRow): CellTip | undefined => {
      const gap = bestWorst(valuesOf(row));
      if (gap === null) return undefined;
      // No engine names the brand, or every engine is at the same rate: there is no best engine to point to
      if (gap.best === null) return { content: compare('zero') };
      if (gap.best.code === gap.worst.code) return { content: compare('equal', { rate: percent(gap.worst.value) }) };
      const rated = valuesOf(row).filter((value) => value.state === 'ok');
      const counts = formatList(
        rated.map((value) =>
          t('columns.engineCount', {
            engine: labelOf(value.code),
            count: words.basis(cellFigure(summaryOf(row, value.code), key)) ?? EMPTY_VALUE,
          }),
        ),
        locale,
      );
      return {
        content: view('gapSome', {
          best: labelOf(gap.best.code),
          bestRate: percent(gap.best.value),
          worst: labelOf(gap.worst.code),
          worstRate: percent(gap.worst.value),
          count: gap.counted,
        }),
        detail:
          gap.leftOut.length === 0
            ? counts
            : view('gapDetailLeftOut', { counts, engines: formatList(gap.leftOut.map(labelOf), locale) }),
      };
    };
    const gapColumn = col.volumeTrend<TRow>('engine_gap', (row) => engineGapOf(valuesOf(row)), {
      header: view('gapHeader'),
      headerTooltip: view('gapTip'),
      priority: 3,
      width: GAP_WIDTH,
      sortable: true,
      unknown: (row) => ({
        label: EMPTY_VALUE,
        tooltip: cellsOf(row) === undefined ? t('columns.notLoadedTip') : view('gapNone'),
      }),
      known: (_row, points) => <span className="num">{view('gapValue', { points: formatDecimal(points, 1) })}</span>,
      knownTip: gapTip,
    });

    // The weekly line of each engine, and its leader
    const trends = engines.map((engine): DataTableColumn<TRow> => {
      const code = engine.engine.engine_code;
      const pointsOf = (row: TRow): ReturnType<typeof enginePoints> => enginePoints(summaryOf(row, code), key);
      return col.sparkline<TRow>(`trend_${code}`, {
        header: view('trendHeader', { engine: engine.engine.label }),
        headerTooltip: t('columns.trendHeaderTip'),
        priority: 3,
        width: TREND_WIDTH,
        defaultVisible: false,
        cell: (row) => (
          <EngineTrendCell cells={cellsOf(row)} code={code} metric={metric} engine={engine.engine.label} />
        ),
        cellTip: (row) => {
          const points = pointsOf(row);
          if (points === null) return undefined;
          const known = points.flatMap((point) =>
            point.value === null || point.thin ? [] : [{ ...point, value: point.value }],
          );
          const first = known[0];
          const last = known.at(-1);
          if (first === undefined || last === undefined) return { content: t('columns.trendNone') };
          const date = (weekStart: string): string => formatBusinessDate(weekStart, { withYear: false });
          const { pooled, total } = poolNote(points);
          return {
            content:
              first === last
                ? t('columns.trendSingle', { value: percent(first.value), date: date(first.weekStart) })
                : t('columns.trendRange', {
                    first: percent(first.value),
                    firstDate: date(first.weekStart),
                    last: percent(last.value),
                    lastDate: date(last.weekStart),
                  }),
            ...(pooled === 0 ? {} : { detail: view('trendPooled', { pooled, total, sentence: pooling('sentence') }) }),
          };
        },
      });
    });
    const leaders = engines.map((engine): DataTableColumn<TRow> => {
      const code = engine.engine.engine_code;
      const label = engine.engine.label;
      const nameOf = (row: TRow): string | null => leaderOf(row, code)?.leader.name ?? null;
      const base = col.text<TRow>(`leader_${code}`, nameOf, {
        header: view('leaderHeader', { engine: label }),
        headerTooltip: view('leaderNote'),
        priority: 3,
        defaultVisible: false,
        sortable: false,
      });
      return {
        ...base,
        cell: (row) => {
          const found = leaderOf(row, code);
          if (found === null) return <Missing label={EMPTY_VALUE} />;
          const { leader, answers } = found;
          if (leader.state === 'leader' && leader.name !== null) {
            return (
              <span className="block truncate">
                {view('leaderCell', { name: leader.name, share: shareText(leader.share) })}
              </span>
            );
          }
          if (leader.state === 'none-named') return <Missing label={view('leaderNone')} />;
          if (leader.state === 'too-few') return <InsufficientPill answers={answers} tip={false} />;
          return <Missing label={EMPTY_VALUE} />;
        },
        cellTip: (row) => {
          const found = leaderOf(row, code);
          if (found === null) return topicOf(row) === null ? undefined : { content: view('leaderLoadingTip') };
          const { leader, answers } = found;
          if (leader.state === 'leader') return leaderSentence(row, code) ?? undefined;
          if (leader.state === 'none-named') return { content: view('leaderNoneTip', { engine: label }) };
          if (leader.state === 'too-few') {
            return { content: view('leaderFewTip', { engine: label, count: answers, min: MIN_OBSERVATIONS }) };
          }
          return undefined;
        },
      };
    });

    return [...rates, gapColumn, ...countColumns, ...trends, ...leaders];
  }, [
    engines,
    cellsOf,
    topicOf,
    entityStatus,
    entityRows,
    tracked,
    metric,
    rateColumns,
    countColumns,
    words,
    t,
    view,
    compare,
    pooling,
    locale,
  ]);
}
