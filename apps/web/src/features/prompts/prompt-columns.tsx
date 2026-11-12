'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { countText, engineSortId, SORT_ID, type RateMetric } from './prompt-model';
import { ENGINE_COLUMN_WIDTH, useEngineRateColumns, useRateColumns } from './rate-columns';
import { PROMPT_COLUMN_ENTRIES, withColumnEntries } from './seams/columns';
import { useTrendColumn } from './trend-column';
import { col, type UnknownValue } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import type { EngineSummary, MetricCell, ProjectEngine, Prompt, PromptSummaryRow } from '@/lib/api/types';
import { EMPTY_VALUE, formatList } from '@/lib/format';
import { cellFigure, validAnswers } from '@/lib/rates/rate-model';

/** A row of the Prompts tab: the prompt, its counts when the summary has them, and its facts in words. */
export interface PromptRow {
  prompt: Prompt;
  summary: PromptSummaryRow | undefined;
  /** The counts of this window have arrived, so a prompt without a row in them has no answers rather than no counts yet. */
  countsLoaded: boolean;
  /** The prompt's topics, joined; `null` without one. */
  topics: string | null;
  /** The prompt's topics, each with where it sits in the tree ("SEO / Technical SEO"; its name when the tree is not read). */
  topicList: readonly { name: string; path: string }[];
  /** The country's name; `null` for a prompt without a country. */
  country: string | null;
}

const METRICS = ['mentioned', 'cited'] as const;
type EngineMetric = (typeof METRICS)[number];
/**
 * Two columns per engine, Mentioned and Cited, each a count of valid answers ("4 of 8", spec section 4.5).
 * A prompt without an answer on the engine in the window says so; one whose answers were all invalid shows
 * "n/a" with how many there were; counts that are not there (`cellsOf` gives `undefined`: the summary has not
 * loaded) show "n/a" and say so. Where some answers were not valid the cell says how many were. Each column
 * sorts by its rate, high to low first, an empty cell last: it is a `volumeTrend` column (a count with its own
 * cell), which sorts numbers and starts high to low. `cellsOf` must keep its identity between renders (a
 * module-level function). With `defaultVisible: false` they wait in the column chooser.
 */
export function useEngineColumns<TRow>(
  engines: readonly ProjectEngine[],
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined,
  { sortable, note, defaultVisible }: { sortable: boolean; note?: string; defaultVisible?: boolean },
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
        return METRICS.map((metric) => {
          const column = col.volumeTrend<TRow>(
            engineSortId(code, metric),
            (row) => cellOf(row, metric)?.value ?? null,
            {
              header: t(metric, { engine: label }),
              headerTooltip: note === undefined ? t(`${metric}Tip`) : `${t(`${metric}Tip`)}. ${note}`,
              width: ENGINE_COLUMN_WIDTH,
              sortable,
              defaultVisible,
              unknown: (row) => unknown(row, metric),
              known: (row) => <span className="num">{countText(cellOf(row, metric)) ?? EMPTY_VALUE}</span>,
              knownTip: (row) => {
                const cell = cellOf(row, metric);
                if (cell === undefined) return undefined;
                // A topic's cell counts its answers in `pooled`; a prompt's in the denominator
                const valid = validAnswers(cell);
                return cell.n_observations > valid
                  ? { content: t('validOfTip', { valid, all: cell.n_observations }) }
                  : undefined;
              },
            },
          );
          // The count shows whatever there are; the sort puts a rate over too few answers with those that have none
          return column.sortValue === undefined
            ? column
            : {
                ...column,
                sortValue: (row: TRow) =>
                  cellFigure(
                    cellsOf(row)?.find((cell) => cell.engine_code === code),
                    metric,
                  ).value,
              };
        });
      }),
    [engines, cellsOf, sortable, note, defaultVisible, t],
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

/**
 * The columns of the Prompts tab (ADR-DS-022 decision 9): Prompt, Topic, Country, Mention rate and Citation
 * rate (the average of the engines shown), Trend (the weekly mention rate), then each engine shown with the
 * value of `metric`. The counts of
 * Mentioned and Cited per engine wait in the column chooser.
 */
export function usePromptColumns(engines: readonly ProjectEngine[], metric: RateMetric): PromptColumns {
  const t = useTranslations('prompts');
  const root = useTranslations();
  const locale = useLocale();
  const { mention, citation } = useRateColumns(engines, cellsOfPrompt);
  const trend = useTrendColumn(engines, cellsOfPrompt);
  const engineRateColumns = useEngineRateColumns(engines, cellsOfPrompt, metric);
  const countColumns = useEngineColumns(engines, cellsOfPrompt, { sortable: true, defaultVisible: false });
  return useMemo(() => {
    const builtIn: DataTableColumn<PromptRow>[] = [
      col.keyword<PromptRow>(SORT_ID.prompt, (row) => row.prompt.current_version.text, {
        header: t('columns.prompt'),
        trailing: (row) => (row.prompt.is_branded ? <Badge>{t('branded')}</Badge> : null),
      }),
      {
        // The topic as a badge, the first one when a prompt has several; where it sits in the tree is the cell's tooltip,
        // which the table opens when the cell takes the keyboard focus
        ...col.badge<PromptRow>(
          SORT_ID.topic,
          (row) => {
            const [first, ...others] = row.topicList;
            if (first === undefined) return null;
            return others.length === 0
              ? { label: first.name }
              : { label: first.name, detail: t('columns.moreTopics', { count: others.length }) };
          },
          {
            header: t('columns.topic'),
            priority: 2,
            // The badge type stops at 180; a topic keeps 140 at least when the table is tight, and ends in an ellipsis
            width: 200,
            minWidth: 140,
            unknown: () => ({ label: t('columns.noTopic') }),
          },
        ),
        cellTip: (row) =>
          // Always there, since the badge ends in an ellipsis when the name is long and the cell is what the keyboard
          // reaches: the path where the topic sits deeper in the tree, else its name
          row.topicList.length === 0
            ? undefined
            : {
                content: formatList(
                  row.topicList.map((topic) => topic.path),
                  locale,
                ),
              },
      },
      col.text<PromptRow>(SORT_ID.country, (row) => row.country, {
        header: t('columns.country'),
        priority: 3,
        width: 136,
      }),
      mention,
      citation,
      trend,
      ...engineRateColumns,
      ...countColumns,
    ];
    // Before the sort fields are read, so a sortable column of an entry is a valid `?sort=` id
    const columns = withColumnEntries(builtIn, PROMPT_COLUMN_ENTRIES, { engines, metric, t: root, locale });
    return {
      columns,
      sortFields: new Set(columns.flatMap((column) => (column.sortValue === undefined ? [] : [column.id]))),
      searchText: (row) => `${row.prompt.current_version.text} ${row.topics ?? ''}`.toLocaleLowerCase(locale),
      rowName: (row) => row.prompt.current_version.text,
    };
  }, [t, root, locale, engines, metric, mention, citation, trend, engineRateColumns, countColumns]);
}
