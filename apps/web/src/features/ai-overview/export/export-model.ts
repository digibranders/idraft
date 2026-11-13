import type { OverviewAggregates } from '../data/aggregates';
import { readNumber, type NumberFigure, type NumberMetricKey, type NumberReading } from '../data/number-sources';
import type { OverviewProject } from '../overview-context';
import type { OverviewScope } from '../scope/scope-model';
import { isBeforeFirstDay } from '@/components/app/date-range/business-date';
import type { EngineCode } from '@/lib/api/types';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';

/**
 * The Export Numbers file of the AI visibility Overview (WP-33 plan T11): what the strip says, as one flat table,
 * built from the same `OverviewAggregates` and the same `readNumber` the strip reads, so the file equals the strip.
 * Pure; the menu holds the words of its toasts, and the file holds only data.
 *
 * Values are raw: a rate is a percent number (61.2), a count is a whole number, and `unit` says which. Unknown is
 * an empty cell, never 0: an engine that is off or left out, a number not exposed, a read still absent and a rate
 * with too few answers all have an empty `value`, and `status` says why.
 */

/** The block of the strip's numbers in the `block` column. */
const NUMBERS_BLOCK = 'numbers';

export const NUMBERS_HEADER = [
  'block',
  'project',
  'number',
  'engine',
  'value',
  'unit',
  'numerator',
  'denominator',
  'n_observations',
  'prompts',
  'status',
  'window_from',
  'window_to',
  'compare_from',
  'compare_to',
  'country',
  'topic',
  'branded',
  'method',
  'is_estimate',
] as const;

/**
 * The notes every Numbers file must carry. The file holds no sentence of its own: the caller words each key (from
 * the message catalog) and `numbersCsv` takes a `NumbersNotes` with all of them, so a missing one does not compile.
 * - `unknownIsEmpty`: an empty `value` is unknown, never 0, and `status` says why.
 * - `pooledCounts`: `numerator` over `denominator` is NOT the `value` of a prompt weighted row. The value is the mean
 *   of each prompt's own rate (docs/16 section 3); the numerator and denominator are the pooled answer counts the
 *   strip shows (e.g. value 66.25 with 110 of 167 answers, where 110/167 is 65.87).
 */
export const NUMBERS_NOTE_KEYS = ['unknownIsEmpty', 'pooledCounts'] as const;
export type NumbersNoteKey = (typeof NUMBERS_NOTE_KEYS)[number];
export type NumbersNotes = Readonly<Record<NumbersNoteKey, string>>;

/** A table of a card, as the card hands it over (`useExportBlock`): its own columns, under the id of the card. */
export interface ExportBlock {
  id: string;
  header: readonly string[];
  rows: readonly (readonly CsvCell[])[];
}

export interface NumbersTable {
  header: string[];
  rows: CsvCell[][];
  /** The notes the file must carry, always all of them: the caller words each one. */
  noteKeys: readonly NumbersNoteKey[];
}

/** What the file adds to the Numbers: the words of its notes, the tables of the cards that are ready, more notes. */
export interface NumbersCsvExtras {
  notes: NumbersNotes;
  blocks?: readonly ExportBlock[];
  /** Notes after the required ones, e.g. how many blocks were still loading. */
  extraNotes?: readonly string[];
}

interface NumberSpec {
  metric: NumberMetricKey;
  unit: 'percent' | 'count';
  /**
   * How the value is averaged: a count has none, a share of voice weights every answer once. A human readable
   * label by design (the plan keeps "prompt weighted"), unlike the snake_case `status` keys.
   */
  method: 'prompt weighted' | 'answer weighted' | 'pooled' | 'count';
  /** What `n_observations` counts: every answer seen of the engine, the denominator itself, or nothing. */
  observations: 'allAnswers' | 'denominator' | null;
}

/** In the order of the file: the prompts, then each number for the engines in the catalog order. */
const NUMBERS: readonly NumberSpec[] = [
  { metric: 'ai.prompts_in_scope', unit: 'count', method: 'count', observations: null },
  { metric: 'ai.valid_answers', unit: 'count', method: 'count', observations: 'allAnswers' },
  { metric: 'ai.mention_rate', unit: 'percent', method: 'prompt weighted', observations: 'allAnswers' },
  { metric: 'ai.citation_rate', unit: 'percent', method: 'prompt weighted', observations: 'allAnswers' },
  { metric: 'ai.mention_and_citation_rate', unit: 'percent', method: 'prompt weighted', observations: 'allAnswers' },
  { metric: 'ai.share_of_voice', unit: 'percent', method: 'answer weighted', observations: 'allAnswers' },
  { metric: 'ai.citation_share', unit: 'percent', method: 'pooled', observations: null },
  { metric: 'ai.fanout_presence_rate', unit: 'percent', method: 'pooled', observations: 'denominator' },
];

const REASON_STATUS = {
  noAnswers: 'no_answers',
  noneValid: 'no_valid_answers',
  noBrandNamed: 'no_brand_named',
} as const;

function statusOf(reading: NumberReading): string {
  switch (reading.status) {
    case 'notAsked':
      return reading.why === 'off' ? 'off' : 'not_asked';
    case 'notExposed':
      return 'not_exposed';
    case 'unread':
      return 'unread';
    case 'read':
      if (reading.figure.state === 'none') return REASON_STATUS[reading.figure.reason ?? 'noAnswers'];
      return reading.figure.state;
  }
}

/** A rate as a percent number to two places, so the float noise of 0.3125 * 100 does not reach the file. */
const percent = (rate: number): number => Math.round(rate * 10000) / 100;

/** The value of a number: only when it is known, and a count as it is. */
function valueOf(spec: NumberSpec, figure: NumberFigure): number | null {
  if (figure.state !== 'ok' || figure.value === null) return null;
  return spec.unit === 'percent' ? percent(figure.value) : figure.value;
}

/** The text of a cell is written so a spreadsheet does not read it as a formula; a number or nothing as it is. */
const safe = (cell: CsvCell): CsvCell => (typeof cell === 'string' ? safeText(cell) : cell);

/** The columns that say which scope the numbers are of; the same on every row. */
function scopeCells(scope: OverviewScope): CsvCell[] {
  const compared = scope.compare && !isBeforeFirstDay(scope.previous.from);
  return [
    scope.range.from,
    scope.range.to,
    compared ? scope.previous.from : null,
    compared ? scope.previous.to : null,
    scope.country ?? 'all',
    scope.topic ?? 'all',
    scope.branded,
  ];
}

function numberRow(
  spec: NumberSpec,
  engineCode: EngineCode | null,
  reading: NumberReading,
  allAnswers: number,
  project: string,
  scope: CsvCell[],
): CsvCell[] {
  const figure = reading.status === 'read' ? reading.figure : null;
  const prompts = spec.metric === 'ai.prompts_in_scope' ? (figure?.value ?? null) : (figure?.prompts ?? null);
  const observations =
    spec.observations === 'allAnswers' ? allAnswers : spec.observations === null ? null : (figure?.n ?? null);
  return [
    NUMBERS_BLOCK,
    project,
    spec.metric,
    engineCode,
    figure === null ? null : valueOf(spec, figure),
    spec.unit,
    figure?.k ?? null,
    figure?.n ?? null,
    figure === null ? null : observations,
    prompts,
    statusOf(reading),
    ...scope,
    spec.method,
    'false',
  ].map(safe);
}

/**
 * The numbers of the strip as a table: one row for each number the page can show, and for each engine of a per
 * engine number. `project` names the file and fills its `project` column.
 */
export function buildNumbersTable(
  aggregates: OverviewAggregates,
  scope: OverviewScope,
  project: Pick<OverviewProject, 'slug'>,
): NumbersTable {
  const cells = scopeCells(scope);
  const rows = NUMBERS.flatMap((spec): CsvCell[][] => {
    const read = (engineCode: EngineCode | null, allAnswers: number): CsvCell[][] => {
      const item = { id: spec.metric, metric: spec.metric };
      const reading = readNumber(aggregates, engineCode === null ? item : { ...item, engine: engineCode });
      return reading === null ? [] : [numberRow(spec, engineCode, reading, allAnswers, project.slug, cells)];
    };
    return spec.metric === 'ai.prompts_in_scope'
      ? read(null, 0)
      : aggregates.engines.flatMap((engine) => read(engine.engineCode, engine.allAnswers));
  });
  return { header: [...NUMBERS_HEADER], rows, noteKeys: NUMBERS_NOTE_KEYS };
}

/**
 * The file: the numbers, then each block of a card after a blank line under its own header (its first column is
 * `block`, as the numbers' is), then a blank line and the notes. The blocks are written in the order given.
 */
export function numbersCsv(
  aggregates: OverviewAggregates,
  scope: OverviewScope,
  project: Pick<OverviewProject, 'slug'>,
  { notes, blocks = [], extraNotes = [] }: NumbersCsvExtras,
): CsvTable {
  const table = buildNumbersTable(aggregates, scope, project);
  const rows: CsvCell[][] = [...table.rows];
  for (const block of blocks) {
    rows.push([], ['block', ...block.header].map(safe));
    for (const row of block.rows) rows.push([block.id, ...row].map(safe));
  }
  rows.push([]);
  for (const note of [...table.noteKeys.map((key) => notes[key]), ...extraNotes]) rows.push(['note', note].map(safe));
  return { header: table.header, rows };
}

/** The name of the file: the project and the window its numbers are of. */
export const exportFileName = (project: Pick<OverviewProject, 'slug'>, scope: OverviewScope): string =>
  `ai-overview-${project.slug}-${scope.range.from}-to-${scope.range.to}.csv`;
