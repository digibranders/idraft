import { averageOfEngines, engineOf, engineRateOver, type EngineRate } from './engine-rows';
import type { EngineSummaryWithFacts, FactsRow, TrackedEntity } from './types';
import type { EntityCells, MetricCell } from '@/lib/api/types';
import { validAnswers } from '@/lib/rates/rate-model';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** How many brands or links a list popover shows. */
export const LIST_SIZE = 10;

/** The answers of one engine behind a brand's rate, valid for one prompt on one engine only. */
export interface BrandCount {
  code: string;
  k: number;
  n: number;
}

export interface BrandRow {
  /** 1 for the brand named most; `null` for a tracked brand with no rate, which is kept in the list and not ranked. */
  place: number | null;
  /** The entity id of a tracked brand, null for a brand nobody tracks. */
  entityId: string | null;
  name: string;
  own: boolean;
  /** A tracked entity (own or competitor). A brand that is not tracked can be added as a competitor. */
  tracked: boolean;
  /**
   * Equal-weight average over the engines in scope of each engine's prompt-weighted share of answers naming it; `null`
   * for a tracked brand whose summary holds no cell on any engine in scope (just added, answers not read again yet):
   * unknown, never 0.
   */
  rate: number | null;
  /** Set only for one prompt on one engine: a count of answers, which no average of rates has. */
  counts: BrandCount | null;
}

/**
 * `not_collected`: the rows carry no brand cell at all (no `include=entities`, no other brands).
 * `unobserved`: no valid answer on the engines in scope. `too_few_answers`: no engine has `MIN_OBSERVATIONS`.
 */
export type BrandsUnknown = 'not_collected' | 'unobserved' | 'too_few_answers';

/**
 * The own brand pinned under the list. It has no place and no rate when no engine in scope holds a cell for it on any
 * row: its rate is then unknown, never 0.
 */
export interface PinnedOwnBrand extends Omit<BrandRow, 'place' | 'rate'> {
  place: number | null;
  rate: number | null;
}

export interface BrandsReading {
  state: 'ok' | 'unknown';
  reason: BrandsUnknown | null;
  /** The top `LIST_SIZE` brands, most named first. */
  shown: BrandRow[];
  /** The own brand when it is not in `shown`, pinned under the list. */
  own: PinnedOwnBrand | null;
  /** Engines the rates rest on: those with enough valid answers in the rows that carry brand cells. */
  codes: string[];
  /** Valid answers of those engines in the rows that carry brand cells. */
  answers: number;
  /** Rows (prompts) the list is over. */
  prompts: number;
  /** Brands the answers name, and the own brand, before the cut. A tracked brand named in no answer is listed, not counted. */
  total: number;
}

interface Candidate {
  entityId: string | null;
  name: string;
  own: boolean;
  tracked: boolean;
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The cell naming a brand on an engine: a tracked entity's, or the one of the brand nobody tracks. */
function cellOfBrand(engine: EngineSummaryWithFacts, brand: Candidate): MetricCell | undefined {
  if (brand.entityId !== null) {
    return engine.entities?.find((cells: EntityCells) => cells.entity_id === brand.entityId)?.mentioned;
  }
  if (engine.other_brands == null) return undefined;
  // The list is complete for the engine: a brand it does not name was named in none of the engine's answers
  return engine.other_brands.find((other) => sameName(other.name, brand.name))?.mentioned ?? notNamed(engine.mentioned);
}

/** A cell of 0 over the answers `reference` counts: observed, and the brand was in none of them. */
const notNamed = (reference: MetricCell): MetricCell => ({
  value: reference.denominator === 0 ? null : 0,
  numerator: 0,
  denominator: reference.denominator,
  n_observations: reference.n_observations,
  pooled: reference.pooled == null ? null : { successes: 0, trials: reference.pooled.trials },
});

/**
 * The brands named in the answers of the rows (a prompt, the prompts of a topic, or one topic row), most named first.
 * A brand's rate is the equal-weight average of the engines in scope that have `MIN_OBSERVATIONS` valid answers, each
 * engine prompt weighted, like every other rate of the page. Tracked entities come from the `entities` cells of the
 * summary, the others from `other_brands`; a brand that is both (added since) counts once, as tracked.
 */
export function brandsOf(
  rows: readonly FactsRow[],
  scope: readonly string[],
  entities: readonly TrackedEntity[],
): BrandsReading {
  const base = { shown: [], own: null, codes: [], answers: 0, prompts: rows.length, total: 0 };
  const candidates: Candidate[] = entities.map((entity) => ({
    entityId: entity.entity_id,
    name: entity.name,
    own: entity.role === 'own',
    tracked: true,
  }));
  for (const row of rows) {
    for (const code of scope) {
      for (const other of engineOf(row, code)?.other_brands ?? []) {
        if (!candidates.some((known) => sameName(known.name, other.name))) {
          candidates.push({ entityId: null, name: other.name, own: false, tracked: false });
        }
      }
    }
  }
  const cellsExist = rows.some((row) =>
    scope.some((code) => {
      const engine = engineOf(row, code);
      return engine !== undefined && carriesBrands(engine);
    }),
  );
  if (!cellsExist) return { state: 'unknown', reason: 'not_collected', ...base };
  // The engines a list rests on: those with enough valid answers over the rows that carry brand cells on them, so
  // "avg of N" never counts an engine whose answers hold no brand
  const answersOf = (code: string): number =>
    rows.reduce((sum, row) => {
      const engine = engineOf(row, code);
      return engine !== undefined && carriesBrands(engine) ? sum + validAnswers(engine.mentioned) : sum;
    }, 0);
  const codes = scope.filter((code) => answersOf(code) >= MIN_OBSERVATIONS);
  const answers = codes.reduce((sum, code) => sum + answersOf(code), 0);
  if (codes.length === 0) {
    return {
      state: 'unknown',
      reason: scope.every((code) => answersOf(code) === 0) ? 'unobserved' : 'too_few_answers',
      ...base,
    };
  }
  const ranked = candidates
    .map((brand) => {
      const rates: EngineRate[] = codes.map((code) =>
        engineRateOver(rows, code, (engine) => cellOfBrand(engine, brand)),
      );
      const { value } = averageOfEngines(rates);
      return { brand, rate: value, rates };
    })
    // A tracked brand is always listed, at 0 or with no rate yet; a brand nobody tracks only when it was named. The own
    // brand with no rate is pinned under the list instead (`pinnedOwn`)
    .filter((entry) =>
      entry.rate === null ? entry.brand.tracked && !entry.brand.own : entry.rate > 0 || entry.brand.tracked,
    )
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
    .map(({ brand, rate }, index): BrandRow => ({
      // A brand with no rate has no place: it is not ranked, only kept
      place: rate === null ? null : index + 1,
      entityId: brand.entityId,
      name: brand.name,
      own: brand.own,
      tracked: brand.tracked,
      rate,
      counts: countsOf(rows, codes, brand),
    }));
  // The top of the list, and below it the competitors the project follows that the cut would drop: a tracked brand is
  // never hidden (the own brand is pinned under the list instead)
  const shown = [
    ...ranked.slice(0, LIST_SIZE),
    ...ranked.slice(LIST_SIZE).filter((row) => row.tracked && !row.own),
  ];
  return {
    state: 'ok',
    reason: null,
    shown,
    own: pinnedOwn(shown, ranked, candidates),
    codes,
    answers,
    prompts: rows.length,
    // The brands the answers name (and the own brand), not the tracked ones that no answer names
    total: ranked.filter((row) => row.own || (row.rate ?? 0) > 0).length,
  };
}

/** Whether the engine of a row holds brand cells at all (tracked entities or the list of other brands). */
const carriesBrands = (engine: EngineSummaryWithFacts): boolean =>
  engine.entities != null || engine.other_brands != null;

/** The own brand when `shown` leaves it out: its ranked row, else a row with an unknown rate (never 0, never dropped). */
function pinnedOwn(
  shown: readonly BrandRow[],
  ranked: readonly BrandRow[],
  candidates: readonly Candidate[],
): PinnedOwnBrand | null {
  if (shown.some((row) => row.own)) return null;
  const row = ranked.find((entry) => entry.own);
  if (row !== undefined) return row;
  const own = candidates.find((candidate) => candidate.own);
  if (own === undefined) return null;
  return {
    entityId: own.entityId,
    name: own.name,
    own: true,
    tracked: own.tracked,
    place: null,
    rate: null,
    counts: null,
  };
}

/** Answers naming the brand, only for one prompt row on one engine: a prompt's cell holds counts, a topic's holds rates. */
function countsOf(rows: readonly FactsRow[], codes: readonly string[], brand: Candidate): BrandCount | null {
  const [row] = rows;
  const [code] = codes;
  if (rows.length !== 1 || codes.length !== 1 || row === undefined || code === undefined) return null;
  const engine = engineOf(row, code);
  const cell = engine === undefined ? undefined : cellOfBrand(engine, brand);
  if (cell === undefined || cell.pooled != null) return null;
  return { code, k: cell.numerator, n: cell.denominator };
}
