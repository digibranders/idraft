import type { Route } from 'next';

import type { TopicDescendants, TopicNode } from '../model-types';
import { topicMembers } from '../topic-nodes';
import { enginePoints, type TopicPoint } from '../topic-points';
import type { PromptWeekView } from './prompt-week-heatmap';
import { heatmapCsv } from '@/components/app/chart/heat-bins';
import type { HeatCell } from '@/components/app/chart/heatmap-grid';
import type { PromptSummaryRow } from '@/lib/api/types';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE } from '@/lib/format';
import { sortByKeys, type CellMetric } from '@/lib/rates/rate-model';

/**
 * The model of the prompt by week heat map (CH-12): which prompts are rows, which weeks are columns, and what each
 * cell holds. A cell is the pooled weekly point the API sends for a prompt on one engine; nothing here pools. Plain
 * data: the words and the links come in as arguments, so everything here is a decision and none of it is English.
 */

/** The columns shown: the newest weeks, so the grid keeps a width a screen can read. */
export const MAX_WEEKS = 14;

/** The name of the file the card's menu downloads, without its extension. */
export const PROMPT_WEEK_FILE_NAME = 'prompt-by-week';

/** The columns of the export: data names, not words for a person. A week is a row, so the export has few columns. */
export const PROMPT_WEEK_EXPORT_HEADER: readonly string[] = [
  'prompt',
  'week_start',
  'rate',
  'successes',
  'answers',
  'pooled_weeks',
  'status',
];

/** Between the names of a topic's path in the topic menu ("CRM / Pricing"). */
const PATH_SEPARATOR = ' / ';

export interface PromptWeekInput {
  prompts: readonly PromptSummaryRow[];
  /** The topic whose prompts are the rows: its own and those of the topics below it. */
  termId: string;
  descendants: TopicDescendants;
  /** The engine whose weekly points are read. */
  code: string;
  metric: CellMetric;
}

export interface PromptWeekRow {
  promptId: string;
  text: string;
  /** One per column, same order; `null` where the prompt has no point for that week. */
  cells: readonly (TopicPoint | null)[];
  /** The rate of the newest week that shows one (a thin point shows none); `null` when no week does. */
  latest: number | null;
}

export interface PromptWeekGrid {
  /** The Mondays that start the weeks, oldest first, at most `MAX_WEEKS`. */
  weeks: string[];
  /** The newest rate first, a prompt without a rate last, ties by prompt text. */
  rows: PromptWeekRow[];
}

/** No topic to read, or no engine: a grid with nothing in it. */
export const NO_GRID: PromptWeekGrid = { weeks: [], rows: [] };

const latestOf = (cells: readonly (TopicPoint | null)[]): number | null => {
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const point = cells[index];
    if (point !== null && point !== undefined && point.value !== null && !point.thin) return point.value;
  }
  return null;
};

/**
 * The prompts of one topic and below, with their pooled weekly points on one engine. A topic the vocabulary tree
 * does not hold has no rows: its prompts cannot be told, and the grid never falls back to every prompt. An engine
 * with no series gives rows without points and a grid without weeks.
 */
export function promptWeekGrid({ prompts, termId, descendants, code, metric }: PromptWeekInput): PromptWeekGrid {
  const members = topicMembers(termId, prompts, descendants) ?? [];
  const series = members.map((prompt) => ({
    prompt,
    points: enginePoints(
      prompt.engines.find((cells) => cells.engine_code === code),
      metric,
    ),
  }));
  const weeks = [...new Set(series.flatMap(({ points }) => (points ?? []).map((point) => point.weekStart)))]
    .sort()
    .slice(-MAX_WEEKS);
  const rows = series.map(({ prompt, points }): PromptWeekRow => {
    const byWeek = new Map((points ?? []).map((point) => [point.weekStart, point] as const));
    const cells = weeks.map((week) => byWeek.get(week) ?? null);
    return { promptId: prompt.prompt_id, text: prompt.text, cells, latest: latestOf(cells) };
  });
  return {
    weeks,
    rows: sortByKeys(
      rows,
      [{ id: 'latest', desc: true }],
      (row) => row.latest,
      (row) => row.text,
    ),
  };
}

/** What the card has to say, already in words. A rate that is unknown never reaches `percent`. */
export interface PromptWeekWords {
  rateTip: RateTipWords;
  /** A rate as the cell prints it ("63%"). */
  percent: (value: number) => string;
  /** A Monday as a column and a tip print it ("Oct 26"). */
  date: (iso: string) => string;
  /** A point that holds several weeks: "4 weeks to Oct 26". */
  pooledTitle: (weeks: number, date: string) => string;
  /** A point that holds only its own week: "Week of Oct 26". */
  weekTitle: (date: string) => string;
  /** Share of voice has no count of successes: its percent and the valid answers that name a brand. */
  share: (percent: string, answers: number) => string;
  /** "{prompt}, {title}: {value}" */
  subject: (prompt: string, title: string, value: string) => string;
}

/** The weeks are said only when the point holds several: a point of its own week does not claim to be pooled. */
const titleOf = (point: TopicPoint | null, weekStart: string, words: PromptWeekWords): string =>
  point !== null && point.showsPool
    ? words.pooledTitle(point.weeks, words.date(weekStart))
    : words.weekTitle(words.date(weekStart));

function cellOf(
  text: string,
  weekStart: string,
  point: TopicPoint | null,
  metric: CellMetric,
  words: PromptWeekWords,
): Omit<HeatCell, 'href'> {
  const title = titleOf(point, weekStart, words);
  const say = (value: string): string => words.subject(text, title, value);
  // A week with no point, or a point with no valid answer, is a gap: n/a, never a rate of 0
  if (point === null || point.value === null || point.n === 0) {
    return { value: null, answers: 0, state: 'none', text: '', tip: say(words.rateTip.noAnswers) };
  }
  // Under 4 answers the grid prints the count itself; a percent is never printed without a rate
  if (point.thin) {
    return { value: null, answers: point.n, state: 'insufficient', text: '', tip: say(words.rateTip.thin(point.n)) };
  }
  const counted = metric !== 'share_of_voice' && point.k !== null;
  return {
    value: point.value,
    answers: point.n,
    state: 'ok',
    text: words.percent(point.value),
    tip: say(
      counted
        ? rateTipText({ value: point.value, k: point.k, n: point.n, band: point.band, thin: false }, words.rateTip)
        : words.share(words.rateTip.value(point.value), point.n),
    ),
  };
}

/** The grid as the heat map draws it: a column per week, a row per prompt, each cell with its words. */
export function promptWeekView(
  grid: PromptWeekGrid,
  metric: CellMetric,
  words: PromptWeekWords,
  hrefOf: (promptId: string) => Route | null,
): PromptWeekView {
  return {
    columns: grid.weeks.map((week) => ({ id: week, label: words.date(week) })),
    rows: grid.rows.map((row) => {
      const href = hrefOf(row.promptId) ?? undefined;
      return {
        id: row.promptId,
        label: row.text,
        name: row.text,
        href,
        cells: row.cells.map((point, index) => ({
          ...cellOf(row.text, grid.weeks[index] ?? '', point, metric, words),
          href,
        })),
      };
    }),
  };
}

/** The grid's words as a CSV: the same text as the Table form. */
export const promptWeekCsv = (view: PromptWeekView, rowHeader: string): CsvTable =>
  heatmapCsv({
    rowHeader,
    noneText: EMPTY_VALUE,
    columns: view.columns.map((column) => column.label),
    rows: view.rows.map((row) => ({
      label: row.name,
      cells: row.cells.map(({ state, tip }) => ({ state, tip })),
    })),
  });

const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;

/**
 * The grid as the Export menu writes it: a row for each prompt and week, numbers, with an empty rate and a status
 * where it is unknown, never 0. A week the prompt has no point for is a row with no answers and no pooled weeks.
 */
export function promptWeekExport(grid: PromptWeekGrid): { header: string[]; rows: CsvCell[][] } {
  return {
    header: [...PROMPT_WEEK_EXPORT_HEADER],
    rows: grid.rows.flatMap((row) =>
      grid.weeks.map((week, index): CsvCell[] => {
        const point = row.cells[index] ?? null;
        const shown = point !== null && point.value !== null && point.n > 0;
        const status = !shown ? 'no_answers' : point.thin ? 'insufficient' : 'ok';
        return [
          row.text,
          week,
          shown && !point.thin ? percentNumber(point.value ?? 0) : null,
          point?.k ?? null,
          point?.n ?? 0,
          point?.weeks ?? null,
          status,
        ];
      }),
    ),
  };
}

/** Some prompt has a week with a valid answer, a thin one included: otherwise there is nothing to draw and the card says so. */
export const hasAnyAnswer = (grid: PromptWeekGrid): boolean =>
  grid.rows.some((row) => row.cells.some((point) => point !== null && point.value !== null && point.n > 0));

/** Some cell says it holds several weeks, so the footnote may say that weeks are pooled (C-18). */
export const hasPooledPoint = (grid: PromptWeekGrid): boolean =>
  grid.rows.some((row) => row.cells.some((point) => point !== null && point.showsPool));

export interface TopicChoice {
  /** The term id: the key of the topic's row. */
  key: string;
  /** Its names from the top level down: "CRM / Pricing". */
  label: string;
}

/** The topics to choose from: the real topics, each followed by the ones directly under it; never the row of no topic. */
export const topicChoices = (nodes: readonly TopicNode[]): TopicChoice[] =>
  nodes
    .filter((node) => node.termId !== null)
    .flatMap((node) => [node, ...node.children])
    .map((node) => ({ key: node.key, label: node.path.join(PATH_SEPARATOR) }));

/** The scope's topic when it is one of the choices, else the topic with the most prompts (the first of a tie). */
export function defaultTopic(
  choices: readonly TopicChoice[],
  nodes: readonly TopicNode[],
  scopeTopic: string | null,
): string | null {
  if (scopeTopic !== null && choices.some((choice) => choice.key === scopeTopic)) return scopeTopic;
  const counts = new Map(nodes.flatMap((node) => [node, ...node.children]).map((node) => [node.key, node.promptCount]));
  let best: TopicChoice | null = null;
  for (const choice of choices) {
    if (best === null || (counts.get(choice.key) ?? 0) > (counts.get(best.key) ?? 0)) best = choice;
  }
  return best?.key ?? null;
}
