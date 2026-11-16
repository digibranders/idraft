import { engineValue } from './engine-values';
import { CELL_OF_MEASURE, forMeasure } from './group-rows';
import type { ScopeMetric } from '../../scope/scope-model';
import type { EngineSummary } from '@/lib/api/types';
import { averageRate } from '@/lib/rates/rate-model';
import type { RateState } from '@/lib/stats';

/**
 * The chosen group against all groups (OV-GRP-12): one row per platform and their average, each with the group's rate
 * and the rate of all groups. Every platform is asked whatever the page's Platform says, because the card compares
 * groups, not platforms. Plain data: the card gives the words.
 */

/** A rate with the counts behind it, of a platform or of the average of the platforms. */
export interface Reading {
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  answers: number;
  /** The answers that count; `null` for share of voice and for an average of platforms. */
  successes: number | null;
  /** The platforms an average took part with ("avg of 2"); `null` for one platform. */
  used: number | null;
}

export interface VersusRow {
  /** The platform code, or `average`. */
  id: string;
  label: string;
  average: boolean;
  group: Reading;
  all: Reading;
  /** The group minus all groups in whole points when both have a rate; `null` otherwise. */
  gap: number | null;
}

export interface VersusInput {
  /** The asked platforms, in order, with their names. */
  platforms: readonly { code: string; label: string }[];
  /** The cells of the chosen group on each platform; `undefined` when the group has no row. */
  group: readonly EngineSummary[] | undefined;
  /** The cells of all groups (every prompt in scope); `undefined` while they are not read. */
  all: readonly EngineSummary[] | undefined;
  measure: ScopeMetric;
  averageLabel: string;
}

const AVERAGE = 'average';

function platformReading(cells: readonly EngineSummary[] | undefined, code: string, measure: ScopeMetric): Reading {
  const value = engineValue(
    cells === undefined ? undefined : forMeasure(cells, measure),
    code,
    CELL_OF_MEASURE[measure],
  );
  return {
    state: value.state,
    value: value.state === 'ok' ? value.value : null,
    answers: value.answers,
    successes: value.successes,
    used: null,
  };
}

function averageReading(
  cells: readonly EngineSummary[] | undefined,
  codes: readonly string[],
  measure: ScopeMetric,
): Reading {
  const metric = CELL_OF_MEASURE[measure];
  const mapped = cells === undefined ? [] : forMeasure(cells, measure);
  const average = averageRate(codes.map((code) => mapped.find((cell) => cell.engine_code === code)?.[metric]));
  return {
    state: average.state,
    value: average.state === 'ok' ? average.value : null,
    answers: average.answers,
    successes: null,
    used: average.engines,
  };
}

/** Whole points between two readings that both have a rate, else `null`. */
function gapOf(group: Reading, all: Reading): number | null {
  return group.value === null || all.value === null ? null : Math.round((group.value - all.value) * 100);
}

export function versusRows({ platforms, group, all, measure, averageLabel }: VersusInput): VersusRow[] {
  const codes = platforms.map((platform) => platform.code);
  const row = (id: string, label: string, isAverage: boolean, own: Reading, every: Reading): VersusRow => ({
    id,
    label,
    average: isAverage,
    group: own,
    all: every,
    gap: gapOf(own, every),
  });
  return [
    ...platforms.map((platform) =>
      row(
        platform.code,
        platform.label,
        false,
        platformReading(group, platform.code, measure),
        platformReading(all, platform.code, measure),
      ),
    ),
    row(AVERAGE, averageLabel, true, averageReading(group, codes, measure), averageReading(all, codes, measure)),
  ];
}
