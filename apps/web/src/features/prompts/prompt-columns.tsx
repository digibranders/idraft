'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { countText } from './prompt-model';
import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import type { EngineSummary, MetricCell, ProjectEngine, Prompt, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE } from '@/lib/format';
import type { SortKey } from '@/lib/tables/table-state';

/** A row of the Prompts tab: the prompt, its counts when the summary has them, and its facts in words. */
export interface PromptRow {
  prompt: Prompt;
  summary: PromptSummaryRow | undefined;
  /** The counts of this window have arrived, so a prompt without a row in them has no answers rather than no counts yet. */
  countsLoaded: boolean;
  /** The prompt's topics, joined; `null` without one. */
  topics: string | null;
  /** The country's name; `null` for a prompt without a country. */
  country: string | null;
}

/** A to Z by the prompt's text. */
export const DEFAULT_SORT: readonly SortKey[] = [{ id: 'prompt', desc: false }];

const METRICS = ['mentioned', 'cited'] as const;
type EngineMetric = (typeof METRICS)[number];
/** "Google AI Mode mentioned" in capitals with its sort arrow needs about 176 px. */
const ENGINE_COLUMN_WIDTH = 176;

/**
 * Two columns per engine, Mentioned and Cited, each a count of valid answers ("4 of 8", spec section 4.5).
 * A prompt without an answer on the engine in the window says so; one whose answers were all invalid shows
 * "n/a" with how many there were; counts that are not there (`cellsOf` gives `undefined`: the summary has not
 * loaded) show "n/a" and say so. Where some answers were not valid the cell says how many were. Each column
 * sorts by its rate, high to low first, an empty cell last: it is a `volumeTrend` column (a count with its own
 * cell), which sorts numbers and starts high to low. `cellsOf` must keep its identity between renders (a
 * module-level function).
 */
export function useEngineColumns<TRow>(
  engines: readonly ProjectEngine[],
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined,
  { sortable, note }: { sortable: boolean; note?: string },
): DataTableColumn<TRow>[] {
  const t = useTranslations('prompts.columns');
  return useMemo(
    () =>
      engines.flatMap((engine) => {
        const code = engine.engine.engine_code;
        const label = engine.engine.label;
        const cellOf = (row: TRow, metric: EngineMetric): MetricCell | undefined =>
          cellsOf(row)?.find((cell) => cell.engine_code === code)?.[metric];
        const unknown = (row: TRow, metric: EngineMetric): UnknownValue => {
          if (cellsOf(row) === undefined) return { label: EMPTY_VALUE, tooltip: t('notLoadedTip') };
          const cell = cellOf(row, metric);
          return cell === undefined || cell.n_observations === 0
            ? { label: t('noAnswers'), tooltip: t('noAnswersTip') }
            : { label: EMPTY_VALUE, tooltip: t('noValidTip', { count: cell.n_observations }) };
        };
        return METRICS.map((metric) =>
          col.volumeTrend<TRow>(`${code}_${metric}`, (row) => cellOf(row, metric)?.value ?? null, {
            header: t(metric, { engine: label }),
            headerTooltip: note === undefined ? t(`${metric}Tip`) : `${t(`${metric}Tip`)}. ${note}`,
            width: ENGINE_COLUMN_WIDTH,
            sortable,
            unknown: (row) => unknown(row, metric),
            known: (row) => <span className="num">{countText(cellOf(row, metric)) ?? EMPTY_VALUE}</span>,
            knownTip: (row) => {
              const cell = cellOf(row, metric);
              if (cell === undefined) return undefined;
              // A topic's cell counts its answers in `pooled`; a prompt's in the denominator
              const valid = cell.pooled?.trials ?? cell.denominator;
              return cell.n_observations > valid
                ? { content: t('validOfTip', { valid, all: cell.n_observations }) }
                : undefined;
            },
          }),
        );
      }),
    [engines, cellsOf, sortable, note, t],
  );
}

export interface PromptColumns {
  columns: readonly DataTableColumn<PromptRow>[];
  /** The ids `?sort=` may name. */
  sortFields: ReadonlySet<string>;
  searchText: (row: PromptRow) => string;
  rowName: (row: PromptRow) => string;
}

/** No row in counts that have arrived is no answers; no counts yet is not knowing. */
const cellsOfPrompt = (row: PromptRow): readonly EngineSummary[] | undefined =>
  row.summary?.engines ?? (row.countsLoaded ? [] : undefined);

/** The columns of the Prompts tab (ADR-DS-022 decision 9): Prompt, Topic, Country, then each engine shown. */
export function usePromptColumns(engines: readonly ProjectEngine[]): PromptColumns {
  const t = useTranslations('prompts');
  const locale = useLocale();
  const engineColumns = useEngineColumns(engines, cellsOfPrompt, { sortable: true });
  return useMemo(() => {
    const columns: DataTableColumn<PromptRow>[] = [
      col.keyword<PromptRow>('prompt', (row) => row.prompt.current_version.text, {
        header: t('columns.prompt'),
        trailing: (row) => (row.prompt.is_branded ? <Badge>{t('branded')}</Badge> : null),
      }),
      col.text<PromptRow>('topic', (row) => row.topics, {
        header: t('columns.topic'),
        priority: 2,
        unknown: () => ({ label: t('columns.noTopic') }),
      }),
      col.text<PromptRow>('country', (row) => row.country, { header: t('columns.country'), priority: 3, width: 136 }),
      ...engineColumns,
    ];
    return {
      columns,
      sortFields: new Set(columns.flatMap((column) => (column.sortValue === undefined ? [] : [column.id]))),
      searchText: (row) => `${row.prompt.current_version.text} ${row.topics ?? ''}`.toLocaleLowerCase(locale),
      rowName: (row) => row.prompt.current_version.text,
    };
  }, [t, locale, engineColumns]);
}
