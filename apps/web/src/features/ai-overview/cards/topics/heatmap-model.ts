import type { Route } from 'next';

import type { EngineValue } from './engine-values';
import { CELL_OF, type TopicData, type TopicMetric, type TopicNode } from './model-types';
import { NO_TOPIC } from './topic-nodes';
import { exportCells, orderRows, topicEngineRows, type TopicEngineRow } from './topic-rows';
import { heatmapCsv, type HeatCsvRow } from '@/components/app/chart/heat-bins';
import type { HeatCell, HeatRow } from '@/components/app/chart/heatmap-grid';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE } from '@/lib/format';
import type { AverageRate } from '@/lib/rates/rate-model';

/**
 * The model of the topic heat map card (CH-04, CH-40): which rows, which columns, what each cell says and where it
 * leads, plus the CSV and the export block of the same table. Plain data: the card gives the words and the links, so
 * everything here is a decision and none of it is English.
 */

export type HeatSort = 'prompts' | 'rate' | 'gap';

export interface HeatOptions {
  metric: TopicMetric;
  /** `top`: the top level topics; `all`: each with the topics directly below it as rows that open in place. */
  level: 'top' | 'all';
  sort: HeatSort;
  /** The top level rows shown; the rest are behind the link to the Topics tab. */
  rows: number;
}

/** What the card has to say, already in words. A rate that is unknown never reaches `percent` as 0. */
export interface HeatWords {
  /** The name of the row of the prompts without a topic. */
  noTopic: string;
  rowHeader: string;
  promptsHeader: string;
  /** The head of the average column: "avg of 3". */
  averageHead: (engines: number) => string;
  /** The label of an average in a tip: "avg of 2", or "1 engine". */
  avgLabel: (engines: number) => string;
  /** A rate as the cell prints it ("47%"). */
  percent: (value: number | null) => string;
  integer: (count: number) => string;
  /** What a tip says of one engine's value: its percent with the answers and prompts, or why there is none. */
  cellTip: (value: EngineValue, counted: boolean) => string;
  /** "{topic} on {engine}: {value}" */
  cellSubject: (topic: string, engine: string, value: string) => string;
  averageSubject: (topic: string, average: string, value: string) => string;
  averageNone: (topic: string, value: string) => string;
  averageValue: (percent: string, counts: string, note: string) => string;
  averageNote: (engines: string) => string;
  averageOnly: (engines: string) => string;
  /** One engine and the count behind its rate: "ChatGPT 64 of 136 answers". */
  engineCount: (engine: string, value: EngineValue, counted: boolean) => string;
  noAnswers: string;
  thin: (answers: number) => string;
  list: (items: readonly string[]) => string;
}

/** Where a row and a cell lead; `null` where the page cannot show the scope, and the text is then plain. */
export interface HeatLinks {
  row: (key: string) => Route | null;
  cell: (key: string, engineCode: string) => Route | null;
}

export interface HeatColumnSpec {
  id: string;
  /** Plain text: the card puts the engine's mark beside it. */
  label: string;
  /** The engine code of an engine column; `null` for the average. */
  engine: string | null;
}

export interface HeatModel {
  columns: HeatColumnSpec[];
  /** The rows shown: the cut applied, the children (level `all`) under their topic. */
  rows: HeatRow[];
  /** The top level rows there are, and how many of them are shown. */
  total: number;
  shown: number;
  /** The grid's words as a CSV: the same text as the Table form. */
  csv: CsvTable;
  /** The rows shown as the Export menu writes them: numbers, with an empty cell and a status where a rate is unknown. */
  exportTable: { header: string[]; rows: CsvCell[][] };
  /** Some row has a valid answer on some engine. */
  answered: boolean;
  /** The labels of the asked engines that have no valid answer in any row. */
  unanswered: string[];
}

const AVERAGE_COLUMN = 'average';

/** The average column is drawn from 2 engines: with one it would repeat that column (R3). */
export const showsAverage = (engineCount: number): boolean => engineCount >= 2;

/** The `sort` the Topics tab reads for each order of this card (`parseHeatOrder` of the Prompts page). */
export const TOPICS_TAB_SORT: Readonly<Record<HeatSort, string | undefined>> = {
  prompts: undefined,
  rate: 'avg_rate',
  gap: '-engine_gap',
};

/** The name of the file the card's menu downloads, without its extension. */
export const heatFileName = (metric: TopicMetric): string => `topic-heat-map-${metric}`;

const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;

const csvRows = (rows: readonly HeatRow[]): HeatCsvRow[] =>
  rows.map((row) => ({
    label: row.name,
    prompts: row.prompts,
    cells: row.cells.map(({ state, tip }) => ({ state, tip })),
    children: row.children === undefined ? undefined : csvRows(row.children),
  }));

export function heatRows(
  { nodes, engines }: Pick<TopicData, 'nodes' | 'engines'>,
  options: HeatOptions,
  words: HeatWords,
  links: HeatLinks,
): HeatModel {
  const codes = engines.map((engine) => engine.code);
  const labelOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  const cellMetric = CELL_OF[options.metric];
  // Share of voice has no count of answers that name a brand: its tip says the answers it is over
  const counted = options.metric !== 'share_of_voice';
  const withAverage = showsAverage(engines.length);
  const nameOf = (node: TopicNode): string => (node.key === NO_TOPIC ? words.noTopic : node.name);

  const engineCell = (node: TopicNode, value: EngineValue): HeatCell => {
    // A cell with no answer has no prompts to open
    const href = value.state === 'none' ? null : links.cell(node.key, value.code);
    return {
      value: value.state === 'ok' ? value.value : null,
      answers: value.answers,
      state: value.state,
      // Under 4 answers the grid prints the count itself; a percent is never printed without a rate
      text: value.state === 'ok' ? words.percent(value.value) : '',
      tip: words.cellSubject(nameOf(node), labelOf(value.code), words.cellTip(value, counted)),
      href: href ?? undefined,
    };
  };

  const averageCell = (node: TopicNode, average: AverageRate, values: readonly EngineValue[]): HeatCell => {
    const base = {
      value: average.state === 'ok' ? average.value : null,
      answers: average.answers,
      state: average.state,
    };
    // Without a rate there is no average to count the engines of: the tip does not say "avg of 0"
    if (average.state === 'none') {
      return { ...base, text: '', tip: words.averageNone(nameOf(node), words.noAnswers) };
    }
    if (average.state === 'insufficient') {
      return { ...base, text: '', tip: words.averageNone(nameOf(node), words.thin(average.answers)) };
    }
    // The count of each engine that took part: a percent of equal weight beside one pooled count would read as another rate
    const taking = values.filter((value) => value.state === 'ok');
    const names = words.list(taking.map((value) => labelOf(value.code)));
    const counts = words.list(taking.map((value) => words.engineCount(labelOf(value.code), value, counted)));
    // One engine is not an average of engines: it is said as that engine alone
    const note = taking.length === 1 ? words.averageOnly(names) : words.averageNote(names);
    return {
      ...base,
      text: words.percent(average.value),
      tip: words.averageSubject(
        nameOf(node),
        words.avgLabel(average.engines),
        words.averageValue(words.percent(average.value), counts, note),
      ),
    };
  };

  const rowOf = (row: TopicEngineRow, children: readonly HeatRow[]): HeatRow => {
    const { node } = row;
    const name = nameOf(node);
    const href = links.row(node.key);
    return {
      id: node.key,
      label: name,
      name,
      prompts: words.integer(node.promptCount),
      href: href ?? undefined,
      cells: [
        ...row.values.map((value) => engineCell(node, value)),
        ...(withAverage ? [averageCell(node, row.average, row.values)] : []),
      ],
      children: children.length === 0 ? undefined : children,
    };
  };

  const exportRowOf = (row: TopicEngineRow, level: 1 | 2): CsvCell[] => [
    nameOf(row.node),
    level,
    row.node.promptCount,
    ...row.values.flatMap((value) => exportCells(value)),
    ...(withAverage
      ? [
          row.average.state === 'ok' && row.average.value !== null ? percentNumber(row.average.value) : null,
          row.average.engines,
          row.average.state,
        ]
      : []),
  ];

  const ranked = orderRows(topicEngineRows(nodes, codes, cellMetric), options.sort, true);
  const shown = ranked.slice(0, options.rows).map((row) => ({
    row,
    // The topics directly below, in the same order among themselves
    children:
      options.level === 'all'
        ? orderRows(topicEngineRows(row.node.children, codes, cellMetric), options.sort, false)
        : [],
  }));

  const columns: HeatColumnSpec[] = [
    ...engines.map((engine) => ({ id: engine.code, label: engine.label, engine: engine.code })),
    ...(withAverage ? [{ id: AVERAGE_COLUMN, label: words.averageHead(engines.length), engine: null }] : []),
  ];
  const rows = shown.map(({ row, children }) =>
    rowOf(
      row,
      children.map((child) => rowOf(child, [])),
    ),
  );
  const unanswered = engines
    .filter((engine) => ranked.every((row) => row.values.find((value) => value.code === engine.code)?.state === 'none'))
    .map((engine) => engine.label);

  return {
    columns,
    rows,
    total: ranked.length,
    shown: shown.length,
    csv: heatmapCsv({
      rowHeader: words.rowHeader,
      promptsHeader: words.promptsHeader,
      noneText: EMPTY_VALUE,
      columns: columns.map((column) => column.label),
      rows: csvRows(rows),
    }),
    exportTable: {
      header: [
        'topic',
        'level',
        'prompts',
        ...codes.flatMap((code) => [`${code}_rate`, `${code}_answers`, `${code}_status`]),
        ...(withAverage ? ['average_rate', 'average_engines', 'average_status'] : []),
      ],
      rows: shown.flatMap(({ row, children }) => [
        exportRowOf(row, 1),
        ...children.map((child) => exportRowOf(child, 2)),
      ]),
    },
    answered: ranked.some((row) => row.values.some((value) => value.state !== 'none')),
    unanswered,
  };
}
