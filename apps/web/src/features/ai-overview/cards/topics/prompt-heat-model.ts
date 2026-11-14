import type { Route } from 'next';

import type { EngineValue } from './engine-values';
import { showsAverage, type HeatColumnSpec } from './heatmap-model';
import type { EngineInfo } from './model-types';
import { promptEngineRows, type PromptEngineRow } from './prompt-rows';
import { exportCells } from './topic-rows';
import { heatmapCsv, type HeatCsvRow } from '@/components/app/chart/heat-bins';
import type { HeatCell, HeatRow } from '@/components/app/chart/heatmap-grid';
import type { PromptSummaryRow } from '@/lib/api/types';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE } from '@/lib/format';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import { sortByKeys, type AverageRate, type CellMetric } from '@/lib/rates/rate-model';

/**
 * The model of the prompt heat map card (CH-11): which prompts, in which order, what each cell says and where it
 * leads, plus the CSV and the export block of the same table. Plain data: the card gives the words and the links, so
 * everything here is a decision and none of it is English.
 */

/** The catalog offers no metric for this card: it is the mention rate. */
export const PROMPT_HEAT_METRIC: CellMetric = 'mentioned';

export type PromptHeatSort = 'most_named' | 'least_named';

export interface PromptHeatOptions {
  sort: PromptHeatSort;
  /** The prompts shown, taken after the sort; the rest are behind the link to the Prompts tab. */
  rows: number;
}

export interface PromptHeatInput {
  prompts: readonly PromptSummaryRow[];
  /** The asked engines, in the order of the columns. */
  engines: readonly EngineInfo[];
  /** The topic terms, for the place of each prompt; empty gives no path. */
  tree: readonly NamedTerm[];
}

/** What the card has to say, already in words. A rate that is unknown never reaches `percent` as 0. */
export interface PromptHeatWords {
  rowHeader: string;
  /** The head of the average column: "avg of 3". */
  averageHead: (engines: number) => string;
  /** The label of an average in a tip: "avg of 2", or "1 engine". */
  avgLabel: (engines: number) => string;
  /** A rate as the cell prints it ("47%"). */
  percent: (value: number | null) => string;
  /** What a tip says of one engine's value: its percent with the answers, or why there is none. */
  cellTip: (value: EngineValue, counted: boolean) => string;
  /** "Last valid answer Nov 11", or that there is none. */
  lastValid: (iso: string | null) => string;
  /** The accessible name of a row: the prompt and, when it has one, its topic. */
  rowName: (text: string, path: string | null) => string;
  /** "{prompt} on {engine}: {value}. {last valid}" */
  cellSubject: (prompt: string, engine: string, value: string, lastValid: string) => string;
  averageSubject: (prompt: string, average: string, value: string, lastValid: string) => string;
  averageNone: (prompt: string, value: string, lastValid: string) => string;
  averageValue: (percent: string, counts: string, note: string) => string;
  averageNote: (engines: string) => string;
  averageOnly: (engines: string) => string;
  /** One engine and the count behind its rate: "ChatGPT 8 of 12 answers". */
  engineCount: (engine: string, value: EngineValue, counted: boolean) => string;
  noAnswers: string;
  thin: (answers: number) => string;
  list: (items: readonly string[]) => string;
}

/** Where a prompt leads; `null` where the page cannot show the scope, and the text is then plain. */
export interface PromptHeatLinks {
  prompt: (promptId: string) => Route | null;
}

/** A grid row, with the prompt and its place apart so the card can draw two lines. */
export interface PromptHeatRow extends Omit<HeatRow, 'label'> {
  /** The prompt as asked. */
  text: string;
  /** The place of its first topic ("SEO / Technical SEO"); `null` when it has none. */
  path: string | null;
}

export interface PromptHeatModel {
  columns: HeatColumnSpec[];
  /** The prompts shown: sorted, then cut. */
  rows: PromptHeatRow[];
  /** The prompts there are, and how many of them are shown. */
  total: number;
  shown: number;
  /** The grid's words as a CSV: the same text as the Table form. */
  csv: CsvTable;
  /** The rows shown as the Export menu writes them: numbers, with an empty cell and a status where a rate is unknown. */
  exportTable: { header: string[]; rows: CsvCell[][] };
  /** Some prompt has an answer, valid or not, on some engine. */
  answered: boolean;
  /** The labels of the asked engines that have no valid answer for any prompt. */
  unanswered: string[];
}

const AVERAGE_COLUMN = 'average';

/** The columns of the export before the engines': data names, not words for a person. */
export const PROMPT_HEAT_EXPORT_HEAD = ['prompt', 'topic', 'last_valid_at'] as const;

/** The name of the file the card's menu downloads, without its extension. */
export const PROMPT_HEAT_FILE_NAME = 'prompts-by-engine';

const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;

const csvRows = (rows: readonly PromptHeatRow[]): HeatCsvRow[] =>
  rows.map((row) => ({ label: row.name, cells: row.cells.map(({ state, tip }) => ({ state, tip })) }));

export function promptHeatRows(
  { prompts, engines, tree }: PromptHeatInput,
  options: PromptHeatOptions,
  words: PromptHeatWords,
  links: PromptHeatLinks,
): PromptHeatModel {
  const codes = engines.map((engine) => engine.code);
  const labelOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  const withAverage = showsAverage(engines.length);

  // One row per prompt, whatever the number of its topics. The order is that of the average, a row without a rate
  // last whichever way it runs, and the cut is taken from the ordered rows so it never hides the worst
  const ordered = sortByKeys(
    promptEngineRows(prompts, codes, PROMPT_HEAT_METRIC, tree),
    [{ id: 'rate', desc: options.sort === 'most_named' }],
    (row) => row.average.value,
    (row) => row.prompt.text,
  );
  const shown = ordered.slice(0, options.rows);

  const engineCell = (row: PromptEngineRow, value: EngineValue, href: Route | null): HeatCell => ({
    value: value.state === 'ok' ? value.value : null,
    answers: value.answers,
    state: value.state,
    // Under 4 answers the grid prints the count itself; a percent is never printed without a rate
    text: value.state === 'ok' ? words.percent(value.value) : '',
    tip: words.cellSubject(
      row.prompt.text,
      labelOf(value.code),
      words.cellTip(value, true),
      words.lastValid(row.lastValidAt),
    ),
    href: href ?? undefined,
  });

  // The average is a summary of the cells beside it and leads nowhere of its own
  const averageCell = (row: PromptEngineRow): HeatCell => {
    const { average, prompt, values } = row;
    const last = words.lastValid(row.lastValidAt);
    const base = {
      value: average.state === 'ok' ? average.value : null,
      answers: average.answers,
      state: average.state,
    };
    // Without a rate there is no average to count the engines of: the tip does not say "avg of 0"
    if (average.state === 'none') {
      return { ...base, text: '', tip: words.averageNone(prompt.text, words.noAnswers, last) };
    }
    if (average.state === 'insufficient') {
      return { ...base, text: '', tip: words.averageNone(prompt.text, words.thin(average.answers), last) };
    }
    // The count of each engine that took part: a percent of equal weight beside one pooled count would read as another rate
    const taking = values.filter((value) => value.state === 'ok');
    const names = words.list(taking.map((value) => labelOf(value.code)));
    const counts = words.list(taking.map((value) => words.engineCount(labelOf(value.code), value, true)));
    // One engine is not an average of engines: it is said as that engine alone
    const note = taking.length === 1 ? words.averageOnly(names) : words.averageNote(names);
    return {
      ...base,
      text: words.percent(average.value),
      tip: words.averageSubject(
        prompt.text,
        words.avgLabel(average.engines),
        words.averageValue(words.percent(average.value), counts, note),
        last,
      ),
    };
  };

  const rows = shown.map((row): PromptHeatRow => {
    const href = links.prompt(row.prompt.prompt_id);
    return {
      id: row.prompt.prompt_id,
      text: row.prompt.text,
      path: row.path,
      name: words.rowName(row.prompt.text, row.path),
      href: href ?? undefined,
      // A prompt with no answer on an engine still opens: the prompt is there to look at
      cells: [...row.values.map((value) => engineCell(row, value, href)), ...(withAverage ? [averageCell(row)] : [])],
    };
  });

  const averageExport = (average: AverageRate): CsvCell[] => [
    average.state === 'ok' && average.value !== null ? percentNumber(average.value) : null,
    average.engines,
    average.state,
  ];
  const columns: HeatColumnSpec[] = [
    ...engines.map((engine) => ({ id: engine.code, label: engine.label, engine: engine.code })),
    ...(withAverage ? [{ id: AVERAGE_COLUMN, label: words.averageHead(engines.length), engine: null }] : []),
  ];

  return {
    columns,
    rows,
    total: ordered.length,
    shown: shown.length,
    csv: heatmapCsv({
      rowHeader: words.rowHeader,
      noneText: EMPTY_VALUE,
      columns: columns.map((column) => column.label),
      rows: csvRows(rows),
    }),
    exportTable: {
      header: [
        ...PROMPT_HEAT_EXPORT_HEAD,
        ...codes.flatMap((code) => [`${code}_rate`, `${code}_answers`, `${code}_status`]),
        ...(withAverage ? ['average_rate', 'average_engines', 'average_status'] : []),
      ],
      rows: shown.map((row): CsvCell[] => [
        row.prompt.text,
        row.path,
        row.lastValidAt,
        ...row.values.flatMap((value) => exportCells(value)),
        ...(withAverage ? averageExport(row.average) : []),
      ]),
    },
    answered: ordered.some((row) => row.values.some((value) => value.state !== 'none')),
    unanswered: engines
      .filter((engine) =>
        ordered.every((row) => row.values.find((value) => value.code === engine.code)?.state === 'none'),
      )
      .map((engine) => engine.label),
  };
}
