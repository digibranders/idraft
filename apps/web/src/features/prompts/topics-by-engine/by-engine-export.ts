import { bestEngine, engineGapOf, engineValue } from './engine-values';
import type { TopicHead } from './topic-rows';
import { CELL_OF_METRIC, type DateRange, type RateMetric } from '@/features/prompts/prompt-model';
import type { ProjectEngine } from '@/lib/api/types';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { safeText } from '@/lib/csv/csv-write';
import { hasRate } from '@/lib/rates/rate-model';

/** The words of the file, from the catalog, so the model holds no text a person reads. */
export interface ByEngineExportLabels {
  topic: string;
  parent: string;
  prompts: string;
  /** The header of an engine's rate in percent, given the engine's label. */
  rate: (engine: string) => string;
  /** The answers that count behind the rate. */
  counted: (engine: string) => string;
  /** The valid answers the rate is of. */
  answers: (engine: string) => string;
  change: (engine: string) => string;
  gap: string;
  best: string;
  engines: string;
}

/** A value to one decimal, as a number a spreadsheet can sum and sort: a percent, or points. */
const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

/**
 * The By engine view as a file (WB-TPE-16): a row per topic, the topics under a parent after it with the parent's name
 * in its own column; per engine the chosen metric as a percent with the answers that count and the valid answers
 * behind it, then the gap between the best and the weakest engine in points, the best engine and how many engines
 * have a rate; and, only when a cell was compared with an earlier window, each engine's change in points. A figure
 * the summary has none for is an empty cell, never 0: an engine without a rate has none, with its counts if it has
 * any. Share of voice has no count of answers that count (its numerator is a sum of shares), so that cell is empty.
 * Every text is written so a spreadsheet does not read it as a formula (12-tables.md section 17).
 */
export function buildByEngineExport(
  heads: readonly TopicHead[],
  engines: readonly ProjectEngine[],
  metric: RateMetric,
  labels: ByEngineExportLabels,
): CsvTable {
  const key = CELL_OF_METRIC[metric];
  const topics = heads.flatMap((head) => [head, ...head.children]);
  const withChange = topics.some((head) => head.engines.some((cell) => cell.previous != null));
  const names = engines.map(({ engine }) => engine.label);
  const header = [
    labels.topic,
    labels.parent,
    labels.prompts,
    ...names.flatMap((name) => [labels.rate(name), labels.counted(name), labels.answers(name)]),
    labels.gap,
    labels.best,
    labels.engines,
    ...(withChange ? names.map(labels.change) : []),
  ];
  const rows = topics.map((head): CsvCell[] => {
    const values = engines.map(({ engine }) => engineValue(head.engines, engine.engine_code, key));
    const gap = engineGapOf(values);
    const best = bestEngine(values);
    const bestLabel =
      best === null ? undefined : engines.find(({ engine }) => engine.engine_code === best.code)?.engine.label;
    return [
      safeText(head.name),
      head.parent === null ? null : safeText(head.parent),
      head.promptCount,
      ...values.flatMap((value): CsvCell[] => [
        value.state === 'ok' && value.value !== null ? oneDecimal(value.value * 100) : null,
        value.state === 'none' ? null : value.successes,
        value.state === 'none' ? null : value.answers,
      ]),
      gap === null ? null : oneDecimal(gap),
      bestLabel === undefined ? null : safeText(bestLabel),
      values.filter((value) => value.state === 'ok').length,
      ...(withChange
        ? engines.map(({ engine }, at): CsvCell => {
            const current = values[at];
            const before = head.engines.find((cell) => cell.engine_code === engine.engine_code)?.previous?.[key];
            if (current?.value == null || current.state !== 'ok' || before == null || !hasRate(before)) return null;
            return before.value === null ? null : oneDecimal((current.value - before.value) * 100);
          })
        : []),
    ];
  });
  return { header, rows };
}

/** The name of a file: the metric it holds and the window its counts are of. */
export const byEngineFileName = (metric: RateMetric, range: DateRange): string =>
  `topics-by-engine-${metric}-${range.from}-to-${range.to}.csv`;
