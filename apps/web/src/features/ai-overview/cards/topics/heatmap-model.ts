import type { Route } from 'next';

import type { EngineValue } from './engine-values';
import { groupRows, isCountedMeasure } from './group-rows';
import type { TopicData, TopicNode } from './model-types';
import { exportCells, type TopicEngineRow } from './topic-rows';
import type { ScopeMetric } from '../../scope/scope-model';
import { heatmapCsv, type HeatCsvRow } from '@/components/app/chart/heat-bins';
import type { HeatCell, HeatRow } from '@/components/app/chart/heatmap-grid';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE } from '@/lib/format';
import type { AverageRate } from '@/lib/rates/rate-model';

/**
 * The model of the groups heat map (CH-04, CH-40, OV-GRP-01 to OV-GRP-08): a row per group (one flat level), a column
 * per asked platform, a column for the platform the API does not collect yet, and from two platforms their equal
 * weight average. Which cell says what, and where it leads, is decided here; none of it is English.
 */

export interface HeatOptions {
  measure: ScopeMetric;
}

/** What the card has to say, already in words. A rate that is unknown never reaches `percent` as 0. */
export interface HeatWords {
  rowHeader: string;
  promptsHeader: string;
  /** The head of the average column: "avg of 3". */
  averageHead: (platforms: number) => string;
  /** The label of an average in a tip: "avg of 2". */
  avgLabel: (platforms: number) => string;
  percent: (value: number | null) => string;
  integer: (count: number) => string;
  /** What a tip says of one platform's value: its percent with the answers and prompts, or why there is none. */
  cellTip: (value: EngineValue, counted: boolean) => string;
  /** "{group} on {platform}: {value}" */
  cellSubject: (group: string, platform: string, value: string) => string;
  averageSubject: (group: string, average: string, value: string) => string;
  averageNone: (group: string, value: string) => string;
  averageValue: (percent: string, counts: string, note: string) => string;
  averageNote: (platforms: string) => string;
  averageOnly: (platforms: string) => string;
  /** One platform and the count behind its rate: "ChatGPT 64 of 136 answers". */
  engineCount: (platform: string, value: EngineValue, counted: boolean) => string;
  noAnswers: string;
  thin: (answers: number) => string;
  list: (items: readonly string[]) => string;
  /** The tip of a cell of the platform that is not collected: "{group} on AI Overview: not collected yet". */
  notCollected: (group: string, platform: string) => string;
}

/**
 * Where a row and a cell lead. A click sets the page's Group (and Platform): the link is the address of the Overview
 * with those keys, which the card follows in place and which still opens in a new tab.
 */
export interface HeatLinks {
  /** The group, on the platform that is chosen. */
  row: (key: string) => Route | null;
  /** The group on one platform. */
  cell: (key: string, engineCode: string) => Route | null;
}

export interface HeatColumnSpec {
  id: string;
  /** Plain text: the card puts the platform's mark beside it. */
  label: string;
  /** The platform code of a platform column; `null` for the average. */
  engine: string | null;
}

/** A platform the API does not collect yet: a column that says so in every row. */
export interface UnavailablePlatform {
  code: string;
  label: string;
}

export interface HeatModel {
  columns: HeatColumnSpec[];
  rows: HeatRow[];
  /** The groups there are. */
  total: number;
  csv: CsvTable;
  exportTable: { header: string[]; rows: CsvCell[][] };
  /** Some group has a valid answer on some platform. */
  answered: boolean;
  /** The labels of the asked platforms that have no valid answer in any group. */
  unanswered: string[];
}

const AVERAGE_COLUMN = 'average';

/** The average column is drawn from 2 platforms: with one it would repeat that column (R3). */
export const showsAverage = (platformCount: number): boolean => platformCount >= 2;

/** The name of the file the card's menu downloads, without its extension. */
export const heatFileName = (measure: ScopeMetric): string => `group-heat-map-${measure}`;

const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;

/** A group's whole name from the top, as the Group select writes it. */
export const groupPath = (node: TopicNode): string => node.path.join(' / ');

/**
 * What a row calls a group: its own name, as the groups are one flat list and the rows are narrow. Two groups of one
 * name are told apart by their path, so a name is never ambiguous.
 */
export function groupNames(nodes: readonly TopicNode[]): ReadonlyMap<string, string> {
  const count = new Map<string, number>();
  for (const node of nodes) count.set(node.name, (count.get(node.name) ?? 0) + 1);
  return new Map(nodes.map((node) => [node.key, (count.get(node.name) ?? 0) > 1 ? groupPath(node) : node.name]));
}

const csvRows = (rows: readonly HeatRow[]): HeatCsvRow[] =>
  rows.map((row) => ({
    label: row.name,
    prompts: row.prompts,
    cells: row.cells.map(({ state, tip }) => ({ state, tip })),
  }));

export function heatRows(
  { nodes, engines }: Pick<TopicData, 'nodes' | 'engines'>,
  { measure }: HeatOptions,
  words: HeatWords,
  links: HeatLinks,
  unavailable: readonly UnavailablePlatform[],
): HeatModel {
  const codes = engines.map((engine) => engine.code);
  const labelOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  // Share of voice has no count of answers that name a brand: its tip says the answers it is over
  const counted = isCountedMeasure(measure);
  const withAverage = showsAverage(engines.length);

  const engineCell = (name: string, key: string, value: EngineValue): HeatCell => {
    // A cell with no answer has no group to open on that platform
    const href = value.state === 'none' ? null : links.cell(key, value.code);
    return {
      value: value.state === 'ok' ? value.value : null,
      answers: value.answers,
      state: value.state,
      // Under 4 answers the grid prints the count itself; a percent is never printed without a rate
      text: value.state === 'ok' ? words.percent(value.value) : '',
      tip: words.cellSubject(name, labelOf(value.code), words.cellTip(value, counted)),
      href: href ?? undefined,
    };
  };

  const averageCell = (name: string, key: string, average: AverageRate, values: readonly EngineValue[]): HeatCell => {
    const base = {
      value: average.state === 'ok' ? average.value : null,
      answers: average.answers,
      state: average.state,
    };
    const href = links.row(key) ?? undefined;
    if (average.state === 'none') return { ...base, text: '', tip: words.averageNone(name, words.noAnswers) };
    if (average.state === 'insufficient') {
      return { ...base, text: '', tip: words.averageNone(name, words.thin(average.answers)), href };
    }
    // The count of each platform that took part: a percent of equal weight beside one pooled count would read as another rate
    const taking = values.filter((value) => value.state === 'ok');
    const names = words.list(taking.map((value) => labelOf(value.code)));
    const counts = words.list(taking.map((value) => words.engineCount(labelOf(value.code), value, counted)));
    // One platform is not an average of platforms: it is said as that platform alone
    const note = taking.length === 1 ? words.averageOnly(names) : words.averageNote(names);
    return {
      ...base,
      text: words.percent(average.value),
      tip: words.averageSubject(
        name,
        words.avgLabel(average.engines),
        words.averageValue(words.percent(average.value), counts, note),
      ),
      href,
    };
  };

  const rowOf = (row: TopicEngineRow): HeatRow => {
    const { node } = row;
    const name = names.get(node.key) ?? node.name;
    return {
      id: node.key,
      label: name,
      name,
      prompts: words.integer(node.promptCount),
      href: links.row(node.key) ?? undefined,
      cells: [
        ...row.values.map((value) => engineCell(name, node.key, value)),
        ...unavailable.map((platform): HeatCell => ({
          value: null,
          answers: 0,
          state: 'none',
          text: '',
          tip: words.notCollected(name, platform.label),
        })),
        ...(withAverage ? [averageCell(name, node.key, row.average, row.values)] : []),
      ],
    };
  };

  const exportRowOf = (row: TopicEngineRow): CsvCell[] => [
    groupPath(row.node),
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

  const ranked = groupRows(nodes, codes, measure);
  const names = groupNames(ranked.map((row) => row.node));
  const columns: HeatColumnSpec[] = [
    ...engines.map((engine) => ({ id: engine.code, label: engine.label, engine: engine.code })),
    ...unavailable.map((platform) => ({ id: platform.code, label: platform.label, engine: platform.code })),
    ...(withAverage ? [{ id: AVERAGE_COLUMN, label: words.averageHead(engines.length), engine: null }] : []),
  ];
  const rows = ranked.map(rowOf);
  const unanswered = engines
    .filter((engine) => ranked.every((row) => row.values.find((value) => value.code === engine.code)?.state === 'none'))
    .map((engine) => engine.label);

  return {
    columns,
    rows,
    total: ranked.length,
    csv: heatmapCsv({
      rowHeader: words.rowHeader,
      promptsHeader: words.promptsHeader,
      noneText: EMPTY_VALUE,
      columns: columns.map((column) => column.label),
      rows: csvRows(rows),
    }),
    exportTable: {
      header: [
        'group',
        'prompts',
        ...codes.flatMap((code) => [`${code}_rate`, `${code}_answers`, `${code}_status`]),
        ...(withAverage ? ['average_rate', 'average_platforms', 'average_status'] : []),
      ],
      rows: ranked.map(exportRowOf),
    },
    answered: ranked.some((row) => row.values.some((value) => value.state !== 'none')),
    unanswered,
  };
}
