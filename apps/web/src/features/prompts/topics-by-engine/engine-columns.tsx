'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';

import { bestWorst, engineGapOf, engineValue, type EngineValue } from './engine-values';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { Button } from '@/components/ui/button';
import { CELL_OF_METRIC, type RateMetric } from '@/features/prompts/prompt-model';
import { useEngineRateColumns } from '@/features/prompts/rate-columns';
import { useRateWords } from '@/features/prompts/rate-view';
import type { EngineSummary, ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatDecimal, formatList, formatPercent } from '@/lib/format';
import { cellFigure } from '@/lib/rates/rate-model';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';

/**
 * The columns of the By platform view of the Groups tab (PR-TVIEW-04): per platform the chosen metric as a percent with
 * the count behind it, and the platform gap. A group's platform cell opens the drawer on its Prompts tab filtered to
 * that platform. The platforms are never pooled here: each column is one platform.
 */

const GAP_WIDTH = 120;

export interface ByEngineOptions<TRow> {
  engines: readonly ProjectEngine[];
  /** Must keep its identity between renders (a module level function): the table keys its work by the columns. */
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined;
  /** The topic a row is, or `null` for a prompt row (its platform cells are plain text). Module level as well. */
  topicOf: (row: TRow) => { key: string; name: string } | null;
  metric: RateMetric;
  /** Opens the topic's prompts on the platform. */
  onDrill: (topicKey: string, engineCode: string) => void;
}

/** The columns, in order: each platform's rate of the chosen metric, then the platform gap. */
export function useByEngineColumns<TRow>({
  engines,
  cellsOf,
  topicOf,
  metric,
  onDrill,
}: ByEngineOptions<TRow>): DataTableColumn<TRow>[] {
  const t = useTranslations('prompts');
  const view = useTranslations('prompts.topicDrawer.byEngineView');
  const compare = useTranslations('prompts.topicDrawer.compare');
  const locale = useLocale();
  const words = useRateWords();
  const rateColumns = useEngineRateColumns(engines, cellsOf, metric);
  // The latest handler, so the columns do not change with every render
  const latestDrill = useRef(onDrill);
  useEffect(() => {
    latestDrill.current = onDrill;
  }, [onDrill]);
  return useMemo((): DataTableColumn<TRow>[] => {
    const key = CELL_OF_METRIC[metric];
    const labelOf = (code: string): string =>
      engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;
    const summaryOf = (row: TRow, code: string): EngineSummary | undefined =>
      cellsOf(row)?.find((cell) => cell.engine_code === code);
    const percent = (value: number | null): string =>
      value === null ? EMPTY_VALUE : formatPercent(value, { decimals: 0 });

    // The platform rate columns: a group's cell opens its prompts on the platform
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
          if (basis === null) return words.text(figure);
          // A group's rate is the mean of its prompts' rates: it says so, and the pooled answers have their own percent
          const cell = summaryOf(row, code)?.[key];
          return cell?.pooled != null && figure.successes !== null && figure.state === 'ok'
            ? view('cellNameAverage', {
                value: words.text(figure),
                prompts: cell.denominator,
                percent: percent(figure.successes / figure.answers),
                basis,
              })
            : view('cellName', { value: words.text(figure), basis });
        },
        cell: (row) => {
          const topic = topicOf(row);
          const content = column.cell(row);
          // A prompt row, and a platform with no answer to open, are plain text
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
      };
    });

    // The platform gap: best minus weakest, over the platforms that have a rate
    const valuesOf = (row: TRow): EngineValue[] =>
      engines.map((engine) => engineValue(cellsOf(row), engine.engine.engine_code, key));
    const gapTip = (row: TRow): CellTip | undefined => {
      const gap = bestWorst(valuesOf(row));
      if (gap === null) return undefined;
      // No platform names the brand, or every platform is at the same rate: there is no best platform to point to
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
      // The preview's 120 px: the type's own minimum is 152
      minWidth: GAP_WIDTH,
      sortable: true,
      unknown: (row) => ({
        label: EMPTY_VALUE,
        tooltip: cellsOf(row) === undefined ? t('columns.notLoadedTip') : view('gapNone'),
      }),
      known: (_row, points) => <span className="num">{view('gapValue', { points: formatDecimal(points, 1) })}</span>,
      knownTip: gapTip,
    });

    return [...rates, gapColumn];
  }, [engines, cellsOf, topicOf, metric, rateColumns, words, t, view, compare, locale]);
}
