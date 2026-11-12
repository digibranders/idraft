import type { PromptRow } from './prompt-columns';
import type { DateRange } from './prompt-model';
import type { MetricCell, ProjectEngine } from '@/lib/api/types';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { safeText } from '@/lib/csv/csv-write';
import { averageRate, validAnswers } from '@/lib/rates/rate-model';

/** The words of the file, from the catalog, so the model holds no text a person reads. */
export interface PromptExportLabels {
  prompt: string;
  topic: string;
  country: string;
  branded: string;
  yes: string;
  no: string;
  mentionRate: string;
  mentionAnswers: string;
  citationRate: string;
  citationAnswers: string;
  /** The header of an engine's Mentioned counts, given the engine's label. */
  mentioned: (engine: string) => string;
  cited: (engine: string) => string;
  /** The valid answers an engine's counts are of. */
  answers: (engine: string) => string;
}

/** A percent to one decimal, as a number a spreadsheet can sum and sort. */
const percentOf = (ratio: number): number => Math.round(ratio * 1000) / 10;

/** The answers that count in a cell, when its figure is whole: a prompt's numerator. */
const hitsOf = (cell: MetricCell | undefined): number | null =>
  cell === undefined || cell.value === null || !Number.isInteger(cell.numerator) ? null : cell.numerator;

/**
 * The prompts as the Prompts table shows them (client side export, parity spec G124): the prompt, its topics,
 * country and whether it is branded, the two rates (the average of the engines shown) as percents with the
 * answers behind each, and each engine's Mentioned and Cited counts over the window with its valid answers, all
 * figures as numbers, as the Rankings export writes its ranks. A figure the summary has none for is an empty cell,
 * and every text cell is written so a spreadsheet does not read it as a formula (12-tables.md section 17).
 */
export function buildPromptExport(
  rows: readonly PromptRow[],
  engines: readonly ProjectEngine[],
  labels: PromptExportLabels,
): CsvTable {
  const codes = engines.map((engine) => engine.engine.engine_code);
  const header = [
    labels.prompt,
    labels.topic,
    labels.country,
    labels.branded,
    labels.mentionRate,
    labels.mentionAnswers,
    labels.citationRate,
    labels.citationAnswers,
    ...engines.flatMap(({ engine }) => [
      labels.mentioned(engine.label),
      labels.cited(engine.label),
      labels.answers(engine.label),
    ]),
  ];
  const body = rows.map((row): CsvCell[] => {
    const cells = row.summary?.engines ?? [];
    const cellOf = (code: string) => cells.find((cell) => cell.engine_code === code);
    const rate = (metric: 'mentioned' | 'cited'): CsvCell[] => {
      const { value, answers } = averageRate(codes.map((code) => cellOf(code)?.[metric]));
      return value === null ? [null, null] : [percentOf(value), answers];
    };
    return [
      safeText(row.prompt.current_version.text),
      row.topicList.length === 0 ? null : safeText(row.topicList.map((topic) => topic.name).join('; ')),
      row.country === null ? null : safeText(row.country),
      row.prompt.is_branded ? labels.yes : labels.no,
      ...rate('mentioned'),
      ...rate('cited'),
      ...codes.flatMap((code) => {
        const mentioned = cellOf(code)?.mentioned;
        return [
          hitsOf(mentioned),
          hitsOf(cellOf(code)?.cited),
          mentioned === undefined || mentioned.value === null ? null : validAnswers(mentioned),
        ];
      }),
    ];
  });
  return { header, rows: body };
}

/** The name of a file: what it holds and the window its counts are of. */
export const exportFileName = (range: DateRange): string => `prompts-${range.from}-to-${range.to}.csv`;
