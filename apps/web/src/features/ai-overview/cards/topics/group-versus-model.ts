import { engineValue } from './engine-values';
import { CELL_OF_MEASURE, forMeasure } from './group-rows';
import type { ScopeMetric } from '../../scope/scope-model';
import type { EngineSummary } from '@/lib/api/types';
import { averageRate } from '@/lib/rates/rate-model';
import { isDetectableDifference, pooledCounts, type Counts, type RateState } from '@/lib/stats';

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
  /** The group's rate minus the rate of all groups, as a ratio (0.05 is 5 points), when both have a rate; `null` otherwise. */
  difference: number | null;
  /**
   * Whether the two rates differ detectably (`isDetectableDifference`, the test of every change icon) on the counts of
   * both; an average is tested on the counts of the platforms that have a rate on both sides, added up. `null` where a
   * count is not known (share of voice) or either side has no rate.
   */
  detectable: boolean | null;
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

/** The difference between two readings that both have a rate, else `null`. */
function differenceOf(group: Reading, all: Reading): number | null {
  return group.value === null || all.value === null ? null : group.value - all.value;
}

/** The counts of a reading that has a rate and whole counts behind it. */
const countsOf = (reading: Reading): Counts | null =>
  reading.value === null || reading.successes === null ? null : { k: reading.successes, n: reading.answers };

export function versusRows({ platforms, group, all, measure, averageLabel }: VersusInput): VersusRow[] {
  const codes = platforms.map((platform) => platform.code);
  const row = (
    id: string,
    label: string,
    isAverage: boolean,
    own: Reading,
    every: Reading,
    detectable: boolean | null,
  ): VersusRow => ({
    id,
    label,
    average: isAverage,
    group: own,
    all: every,
    difference: differenceOf(own, every),
    detectable,
  });
  const single = platforms.map((platform) => ({
    platform,
    own: platformReading(group, platform.code, measure),
    every: platformReading(all, platform.code, measure),
  }));
  // The average is tested on the platforms that have a rate on both sides, their counts added up
  const both = single.flatMap(({ own, every }) => {
    const [a, b] = [countsOf(own), countsOf(every)];
    return a === null || b === null ? [] : [{ a, b }];
  });
  const pooled = (pick: (entry: (typeof both)[number]) => Counts): Counts => pooledCounts(both.map(pick));
  return [
    ...single.map(({ platform, own, every }) =>
      row(platform.code, platform.label, false, own, every, isDetectableDifference(countsOf(own), countsOf(every))),
    ),
    row(
      AVERAGE,
      averageLabel,
      true,
      averageReading(group, codes, measure),
      averageReading(all, codes, measure),
      both.length === 0
        ? null
        : isDetectableDifference(
            pooled((entry) => entry.a),
            pooled((entry) => entry.b),
          ),
    ),
  ];
}
