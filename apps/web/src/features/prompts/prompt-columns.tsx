'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { metricColumns } from './columns/metric-columns';
import { useChangeWords, useComparedWindow, useCompare, type ComparedWindow } from './compare';
import type { PromptFacts } from './facts';
import { cellsOfPrompt, countText, engineSortId, SORT_ID, type RateMetric } from './prompt-model';
import { PlatformMark } from './platform-mark';
import type { PromptScope } from './prompt-queries';
import { ENGINE_COLUMN_WIDTH, useEngineRateColumns, useRateColumns } from './rate-columns';
import { PROMPT_COLUMN_ENTRIES, withColumnEntries } from './seams/columns';
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
 * module-level function). With `defaultVisible: false` they wait in the column chooser. With `marks`, the header and
 * the chooser show the platform's mark before the name.
 */
export function useEngineColumns<TRow>(
  engines: readonly ProjectEngine[],
  cellsOf: (row: TRow) => readonly EngineSummary[] | undefined,
  {
    sortable,
    note,
    defaultVisible,
    marks = false,
  }: { sortable: boolean; note?: string; defaultVisible?: boolean; marks?: boolean },
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
              ...(marks ? { headerIcon: <PlatformMark code={code} /> } : {}),
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
    [engines, cellsOf, sortable, note, defaultVisible, marks, t],
  );
}

export interface PromptColumns {
  columns: readonly DataTableColumn<PromptRow>[];
  /** The ids `?sort=` may name. */
  sortFields: ReadonlySet<string>;
  searchText: (row: PromptRow) => string;
  rowName: (row: PromptRow) => string;
}

/** What the screen knows that decides the columns beyond the engines. */
export interface PromptColumnOptions {
  /** The top bar says All locations: only then has a row anything to say in a Location column. */
  showLocation: boolean;
  /** The facts of every row (`usePromptFacts`), for the columns that later packages register; `undefined` until read. */
  facts: PromptFacts | undefined;
  /** The workspace and project, for the cells that write or read on their own (Brands, Screenshot). */
  project: PromptScope;
  /** The project's time zone. */
  timeZone: string;
}

/** The preview's Location column: 120 px, which holds "United Arab Emirates" cut with its ellipsis. */
const LOCATION_WIDTH = 120;
/** The preview's Prompt column: 300 px. */
const PROMPT_WIDTH = 300;

const DEFAULT_OPTIONS: PromptColumnOptions = {
  showLocation: true,
  facts: undefined,
  project: { workspaceId: '', projectId: '' },
  timeZone: 'UTC',
};

/**
 * The columns of the Prompts tab, in the mock's order: Prompt, Group, Location (only while the top bar says All
 * locations), Mention rate and Citation rate (the average of the platforms shown; the Mention rate cell has the trend
 * icon of its change while the person compares), then each platform's mention rate and its Mentioned and Cited counts, which
 * wait in the column chooser. Intent, Search volume, Avg position, Recommendation rate, Share of voice, Sentiment,
 * Cited links, Brands and Screenshot are built by later packages and plug in through `seams/columns.ts`, which
 * gives them the facts, the platform scope and the comparison.
 */
export function usePromptColumns(
  engines: readonly ProjectEngine[],
  metric: RateMetric,
  /** The window the summary was compared with: the screen builds these columns above its provider of it. */
  comparedWindow?: ComparedWindow,
  { showLocation, facts, project, timeZone }: PromptColumnOptions = DEFAULT_OPTIONS,
): PromptColumns {
  const t = useTranslations('prompts');
  const shell = useTranslations('prompts.shell.columns');
  // The labels of the Add dialog's Type field: the type badge of the Prompt cell says the same words
  const typeWords = useTranslations('prompts.add.details.types');
  const root = useTranslations();
  const locale = useLocale();
  const { compare } = useCompare();
  const changeWords = useChangeWords();
  const contextWindow = useComparedWindow();
  const compared = comparedWindow ?? contextWindow;
  const { mention, citation } = useRateColumns(engines, cellsOfPrompt, { window: compared });
  const engineRateColumns = useEngineRateColumns(engines, cellsOfPrompt, metric, {
    defaultVisible: false,
    marks: true,
  });
  const countColumns = useEngineColumns(engines, cellsOfPrompt, { sortable: true, defaultVisible: false, marks: true });
  return useMemo(() => {
    const builtIn: DataTableColumn<PromptRow>[] = [
      col.keyword<PromptRow>(SORT_ID.prompt, (row) => row.prompt.current_version.text, {
        header: t('columns.prompt'),
        // The preview's 300 px, which the table never narrows (it scrolls instead; the person may drag it)
        width: PROMPT_WIDTH,
        minWidth: PROMPT_WIDTH,
        // Branded, then the type: the type shows only while the cell is wide enough for it (the preview's 24 rem)
        containerQuery: true,
        trailing: (row) => (
          <span className="flex items-center gap-1.5">
            {row.prompt.is_branded ? <Badge>{t('branded')}</Badge> : null}
            <Badge className="hidden @sm:inline-flex">
              {typeWords(row.prompt.prompt_type === 'how_to' ? 'howTo' : row.prompt.prompt_type)}
            </Badge>
          </span>
        ),
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
            // The preview's 160 px, which the table never narrows (it scrolls instead); a long name ends in an ellipsis
            width: 160,
            minWidth: 160,
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
      ...(showLocation
        ? [
            col.text<PromptRow>(SORT_ID.country, (row) => row.country, {
              header: t('columns.country'),
              headerTooltip: shell('locationTip'),
              priority: 3,
              width: LOCATION_WIDTH,
              minWidth: LOCATION_WIDTH,
            }),
          ]
        : []),
      mention,
      citation,
      ...engineRateColumns,
      ...countColumns,
    ];
    // Before the sort fields are read, so a sortable column of an entry is a valid `?sort=` id
    const scope = engines.map((engine) => engine.engine.engine_code);
    const columns = withColumnEntries(builtIn, [...metricColumns, ...PROMPT_COLUMN_ENTRIES], {
      engines,
      scope,
      single: scope.length === 1 ? (scope[0] ?? null) : null,
      facts,
      metric,
      t: root,
      locale,
      compare,
      comparedWindow: compared,
      changeWords,
      project,
      timeZone,
    });
    return {
      columns,
      sortFields: new Set(columns.flatMap((column) => (column.sortValue === undefined ? [] : [column.id]))),
      searchText: (row) => `${row.prompt.current_version.text} ${row.topics ?? ''}`.toLocaleLowerCase(locale),
      rowName: (row) => row.prompt.current_version.text,
    };
  }, [
    t,
    typeWords,
    shell,
    root,
    locale,
    engines,
    metric,
    showLocation,
    facts,
    compare,
    compared,
    changeWords,
    project,
    timeZone,
    mention,
    citation,
    engineRateColumns,
    countColumns,
  ]);
}
