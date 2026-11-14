import type { ChangeWords } from './change-words';
import type { EngineSummary, ProjectEngine } from '@/lib/api/types';
import { averageChangeOf, engineChangeOf, type RateChange } from '@/lib/compare/change-model';
import { acrossEngines, type CellMetric } from '@/lib/rates/rate-model';

export interface AverageChangeInput {
  /** The engine cells of a topic or a prompt; `undefined` while the row is not known. */
  cells: readonly EngineSummary[] | undefined;
  /** The engines the page shows: the average and its change are over these. */
  engines: readonly ProjectEngine[];
  metric: CellMetric;
  /** The compared window as `formatDateRange` writes it; `null` when the response names none (it was not compared). */
  range: string | null;
  words: ChangeWords;
}

export interface AverageChange {
  /** How the average over the engines moved; `null` where it cannot be told. */
  change: RateChange | null;
  /**
   * What a tooltip beside the change says: the previous value and the test, or why there is no change. Empty while the
   * response was not compared (the read held right after comparison was turned on), which has no reason to give yet.
   */
  tip: string;
}

/**
 * The change of the equal weight average of a row's engines and the words about it (WP-19, D4), as the Mention rate
 * column reads it and for the cards and prompts of the topic drawer: only the engines with a rate in both periods take
 * part, a change of one of several engines is named, and a row without a change says why. Pure.
 */
export function averageChange({ cells, engines, metric, range, words }: AverageChangeInput): AverageChange {
  const codes = engines.map((engine) => engine.engine.engine_code);
  const change = averageChangeOf(cells, codes, metric);
  if (change === null) {
    if (range === null) return { change, tip: '' };
    const anyPrevious =
      cells?.some((cell) => codes.some((code) => code === cell.engine_code) && cell.previous != null) === true;
    const gap = !anyPrevious ? 'noPrevious' : codes.length > 1 ? 'noEngineInBoth' : 'tooFew';
    return { change, tip: words.gap(gap) };
  }
  const shown =
    acrossEngines(
      codes.flatMap((code) => {
        const cell = cells?.find((engine) => engine.engine_code === code)?.[metric];
        return cell === undefined ? [] : [cell];
      }),
    )?.engines ?? change.engines;
  const [only, ...others] = codes.filter((code) => engineChangeOf(cells, code, metric) !== null);
  const label = engines.find((engine) => engine.engine.engine_code === only)?.engine.label;
  return {
    change,
    tip: words.tip(change, {
      kind: 'average',
      range,
      metric,
      shown,
      ...(others.length === 0 && label !== undefined ? { engine: label } : {}),
    }),
  };
}
