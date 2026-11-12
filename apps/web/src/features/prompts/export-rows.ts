import type { PromptRow } from './prompt-columns';
import type { DateRange } from './prompt-model';
import { countText } from './prompt-model';
import { averageRate } from './rate-model';
import type { ProjectEngine } from '@/lib/api/types';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { safeText } from '@/lib/csv/csv-write';
import { formatPercent } from '@/lib/format';

/** The words of the file, from the catalog, so the model holds no text a person reads. */
export interface PromptExportLabels {
  prompt: string;
  topic: string;
  country: string;
  branded: string;
  yes: string;
  no: string;
  mentionRate: string;
  citationRate: string;
  /** The header of an engine's Mentioned counts, given the engine's label. */
  mentioned: (engine: string) => string;
  cited: (engine: string) => string;
}

/**
 * The prompts as the Prompts table shows them (client side export, parity spec G124): the prompt, its topics,
 * country and whether it is branded, the two rates (the average of the engines shown) and each engine's Mentioned
 * and Cited counts over the window. A figure the summary has none for is an empty cell.
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
    labels.citationRate,
    ...engines.flatMap((engine) => [labels.mentioned(engine.engine.label), labels.cited(engine.engine.label)]),
  ];
  const body = rows.map((row): CsvCell[] => {
    const cells = row.summary?.engines ?? [];
    const cellOf = (code: string) => cells.find((cell) => cell.engine_code === code);
    const rate = (metric: 'mentioned' | 'cited'): CsvCell => {
      const { value } = averageRate(codes.map((code) => cellOf(code)?.[metric]));
      return value === null ? null : formatPercent(value, { decimals: 0 });
    };
    return [
      safeText(row.prompt.current_version.text),
      row.topicList.length === 0 ? null : row.topicList.map((topic) => topic.name).join('; '),
      row.country,
      row.prompt.is_branded ? labels.yes : labels.no,
      rate('mentioned'),
      rate('cited'),
      ...codes.flatMap((code) => [countText(cellOf(code)?.mentioned), countText(cellOf(code)?.cited)]),
    ];
  });
  return { header, rows: body };
}

/** The name of a file: what it holds and the window its counts are of. */
export const exportFileName = (range: DateRange): string => `prompts-${range.from}-to-${range.to}.csv`;
