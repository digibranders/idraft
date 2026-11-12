'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { CELL_OF_METRIC, countText, engineSortId, hasRate, SORT_ID, type RateMetric } from './prompt-model';
import { averageRate, cellFigure, engineRatesOf, topEngine, type AverageRate } from './rate-model';
import { InsufficientPill, useRateWords } from './rate-view';
import type { RateReading } from './strip-model';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import type { EngineSummary, ProjectEngine } from '@/lib/api/types';
import { EMPTY_VALUE, formatList } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * The rate columns of Topics & Prompts (parity spec G21 to G24, G40 and G41): Mention rate and Citation rate,
 * the average of the engines in scope; Top engine; and, on the Prompts tab, the engines' columns of the metric
 * the switcher chose. Each cell reads the engine cells its row has (`cellsOf`, which must keep its identity
 * between renders: a module-level function), so a topic row reads the server's prompt weighted cells and a
 * prompt row its plain counts, with the same code. A rate over fewer than `MIN_OBSERVATIONS` valid answers is
 * the insufficient pill, not a percent, and sorts with the rows that have none.
 */

/** "Google AI Mode mention" in capitals with its sort arrow needs about 176 px. */
export const ENGINE_COLUMN_WIDTH = 176;

/** What a cell says in place of a rate, and what its tooltip says about why. */
interface Gap {
  label: string;
  tip: string;
}

function Missing({ label }: { label: string }): ReactElement {
  return <span className="text-foreground-tertiary">{label}</span>;
}

const tipOf = (gap: Gap): CellTip => ({ content: gap.tip });

export interface RateColumns<TRow> {
  mention: DataTableColumn<TRow>;
  citation: DataTableColumn<TRow>;
  topEngine: DataTableColumn<TRow>;
}

/**
 * Mention rate, Citation rate and Top engine over the engines shown. The two rates are the equal weight
 * average of the engines that have one, "avg of N" beside the percent (or "1 engine"), with the count behind it
 * and the engines it is over in the tooltip. Top engine names the engine with the highest mention rate, ties
 * by the order of the engines shown, and lists every engine's rate in its tooltip: a pointer, not a ranking
 * (ADR-DS-022 decision 5), which sorts by the engine's name.
 */
export function useRateColumns<TRow>(
  engines: readonly ProjectEngine[],
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined,
  { note }: { note?: string } = {},
): RateColumns<TRow> {
  const t = useTranslations('prompts.columns');
  const rate = useTranslations('prompts.rate');
  const words = useRateWords();
  const locale = useLocale();
  return useMemo(() => {
    const codes = engines.map((engine) => engine.engine.engine_code);
    const labelOf = (code: string): string =>
      engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;
    const withNote = (text: string): string => (note === undefined ? text : `${text}. ${note}`);
    const cellOf = (row: TRow, code: string): EngineSummary | undefined =>
      cellsOf(row)?.find((cell) => cell.engine_code === code);
    const averageOf = (row: TRow, metric: 'mentioned' | 'cited'): AverageRate =>
      averageRate(codes.map((code) => cellOf(row, code)?.[metric]));
    const gapOf = (row: TRow, average: AverageRate): Gap =>
      cellsOf(row) === undefined
        ? { label: EMPTY_VALUE, tip: t('notLoadedTip') }
        : average.reason === 'noAnswers'
          ? { label: EMPTY_VALUE, tip: t('noAnswersTip') }
          : { label: EMPTY_VALUE, tip: t('noValidTip', { count: average.observations }) };

    const rateColumn = (
      id: string,
      metric: 'mentioned' | 'cited',
      header: string,
      tip: string,
    ): DataTableColumn<TRow> => {
      const base = col.volumeTrend<TRow>(id, (row) => averageOf(row, metric).value, {
        header,
        headerTooltip: withNote(tip),
        priority: metric === 'mentioned' ? 1 : 2,
        sortable: true,
        // The cell is drawn below, for it has the insufficient state too
        known: () => null,
      });
      return {
        ...base,
        cell: (row) => {
          const average = averageOf(row, metric);
          if (average.state === 'insufficient') return <InsufficientPill answers={average.answers} tip={false} />;
          if (average.state === 'none') return <Missing label={gapOf(row, average).label} />;
          return (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="num">{words.text(average)}</span>{' '}
              <span className="type-label text-foreground-tertiary">
                {rate('avgLabel', { count: average.engines })}
              </span>
            </span>
          );
        },
        cellTip: (row) => {
          const average = averageOf(row, metric);
          if (average.state === 'insufficient') {
            return { content: rate('insufficientTip', { count: average.answers, min: MIN_OBSERVATIONS }) };
          }
          if (average.state === 'none') return tipOf(gapOf(row, average));
          // The count of each engine that counts: a pooled count beside an equal weight percent would read as another rate
          const counting = codes.flatMap((code) => {
            const cell = cellOf(row, code)?.[metric];
            return cell !== undefined && hasRate(cell)
              ? [{ name: labelOf(code), count: countText(cell) ?? EMPTY_VALUE }]
              : [];
          });
          const engineNames = formatList(
            counting.map(({ name }) => name),
            locale,
          );
          return {
            content: formatList(
              counting.map(({ name, count }) => t('engineCount', { engine: name, count })),
              locale,
            ),
            detail:
              counting.length === 1
                ? rate('onlyTip', { engines: engineNames })
                : rate('avgTip', { engines: engineNames }),
          };
        },
      };
    };

    const topOf = (row: TRow): string | null => {
      const best = topEngine(engineRatesOf(codes, cellsOf(row) ?? []));
      return best === null ? null : labelOf(best.code);
    };
    const topBase = col.text<TRow>(SORT_ID.topEngine, topOf, {
      header: t('topEngine'),
      headerTooltip: t('topEngineTip'),
      priority: 2,
      unknown: (row) => ({
        label: EMPTY_VALUE,
        tooltip: cellsOf(row) === undefined ? t('notLoadedTip') : t('noTopEngineTip'),
      }),
    });
    const topColumn: DataTableColumn<TRow> = {
      ...topBase,
      cellTip: (row) => {
        if (topOf(row) === null) return topBase.cellTip?.(row);
        const cells = cellsOf(row) ?? [];
        const rates = codes.map((code) => {
          const figure = cellFigure(
            cells.find((cell) => cell.engine_code === code),
            'mentioned',
          );
          return t('topEngineRates', { engine: labelOf(code), rate: words.inline(figure) });
        });
        return { content: formatList(rates, locale), detail: t('topEngineTip') };
      },
    };

    return {
      mention: rateColumn(SORT_ID.mention, 'mentioned', t('mentionRate'), t('mentionRateTip')),
      citation: rateColumn(SORT_ID.citation, 'cited', t('citationRate'), t('citationRateTip')),
      topEngine: topColumn,
    };
  }, [engines, cellsOf, note, t, rate, words, locale]);
}

const HEADER_KEY = { mention: 'engineMention', citation: 'engineCitation', sov: 'engineShareOfVoice' } as const;
const TIP_KEY = { mention: 'mentionedTip', citation: 'citedTip', sov: 'shareOfVoiceTip' } as const;

/**
 * One column per engine showing the metric the switcher chose: its value as a percent with the count behind
 * it ("75% 6 of 8"; for share of voice "50% 6 answers", never a count of answers that name the brand, which it
 * is not). The percent is the insufficient pill under `MIN_OBSERVATIONS` valid answers; a prompt without an answer
 * on the engine says so, and one whose answers were all invalid, or none naming a brand, shows "n/a" and why.
 * The column sorts by the value, high to low first.
 */
export function useEngineRateColumns<TRow>(
  engines: readonly ProjectEngine[],
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined,
  metric: RateMetric,
): DataTableColumn<TRow>[] {
  const t = useTranslations('prompts.columns');
  const rate = useTranslations('prompts.rate');
  const words = useRateWords();
  return useMemo(
    () =>
      engines.map((engine) => {
        const code = engine.engine.engine_code;
        const key = CELL_OF_METRIC[metric];
        const summaryOf = (row: TRow): EngineSummary | undefined =>
          cellsOf(row)?.find((cell) => cell.engine_code === code);
        const figureOf = (row: TRow): RateReading => cellFigure(summaryOf(row), key);
        const gapOf = (row: TRow): Gap => {
          if (cellsOf(row) === undefined) return { label: EMPTY_VALUE, tip: t('notLoadedTip') };
          const { reason } = figureOf(row);
          if (reason === 'noAnswers') return { label: t('noAnswers'), tip: t('noAnswersTip') };
          return reason === 'noBrandNamed'
            ? { label: EMPTY_VALUE, tip: t('noBrandTip') }
            : { label: EMPTY_VALUE, tip: t('noValidTip', { count: summaryOf(row)?.mentioned.n_observations ?? 0 }) };
        };
        const base = col.volumeTrend<TRow>(engineSortId(code, 'rate'), (row) => figureOf(row).value, {
          header: t(HEADER_KEY[metric], { engine: engine.engine.label }),
          headerTooltip: t(TIP_KEY[metric]),
          width: ENGINE_COLUMN_WIDTH,
          sortable: true,
          known: () => null,
        });
        return {
          ...base,
          cell: (row) => {
            const figure = figureOf(row);
            if (figure.state === 'insufficient') return <InsufficientPill answers={figure.answers} tip={false} />;
            if (figure.state === 'none') return <Missing label={gapOf(row).label} />;
            const count = metric === 'sov' ? words.basis(figure) : countText(summaryOf(row)?.[key]);
            return (
              <span className="inline-flex items-baseline gap-1.5">
                <span className="num">{words.text(figure)}</span>
                {count === null ? null : (
                  <>
                    {' '}
                    <span className="num type-label text-foreground-tertiary">{count}</span>
                  </>
                )}
              </span>
            );
          },
          cellTip: (row): CellTip | undefined => {
            const figure = figureOf(row);
            if (figure.state === 'insufficient') {
              return {
                content: rate(metric === 'sov' ? 'insufficientShareTip' : 'insufficientTip', {
                  count: figure.answers,
                  min: MIN_OBSERVATIONS,
                }),
              };
            }
            if (figure.state === 'none') return tipOf(gapOf(row));
            if (metric === 'sov') return { content: t('shareBasisTip', { count: figure.answers }) };
            // Where some answers were not valid the cell says how many were
            const all = summaryOf(row)?.[key].n_observations ?? 0;
            return all > figure.answers ? { content: t('validOfTip', { valid: figure.answers, all }) } : undefined;
          },
        };
      }),
    [engines, cellsOf, metric, t, rate, words],
  );
}
