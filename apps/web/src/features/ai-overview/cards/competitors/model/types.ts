import type { RateState } from '@/lib/stats';

/**
 * The plain data the cards of the competitors family draw (WP-35 plan section 3.1). Everything here is derived from
 * the prompts summary by the pure functions beside this file; no card reads a `PromptsSummary` itself. Unknown is
 * never zero: a figure without enough answers has `value: null` and its `state` says why, and a read the summary
 * does not carry is `unread`.
 */

/** A brand of the tracked set: the own brand or a competitor, with what the palette and the footnote need. */
export interface TrackedEntity {
  entityId: string;
  name: string;
  role: 'own' | 'competitor';
  /** The palette slot the project gave it (`ProjectEntity.color_index`); `null` until the entities read is in. */
  colorIndex: number | null;
  /** When it joined the project (an ISO time); `null` until the entities read is in, never invented. */
  addedAt: string | null;
}

/** A competitor added inside the window while the tracked set changed: where the footnote and the boundary come from. */
export interface AddedEntity {
  entityId: string;
  name: string;
  /** The day it was added, in the project zone (`YYYY-MM-DD`). */
  addedOn: string;
}

/** A dashed boundary line: the Monday of the week that holds the day a competitor was added. */
export interface SetBoundary extends AddedEntity {
  weekStart: string;
}

/** The tracked set of one read and everything its footnote says. */
export interface TrackedSet {
  /** Own brand first, then the competitors in the order of the summary; each brand once. */
  entities: TrackedEntity[];
  /** `entity_config_versions.length > 1`: the set changed inside the window. The only trigger of a boundary. */
  changed: boolean;
  /** Empty without the entities read, and when the set did not change. */
  boundaries: SetBoundary[];
  /** The competitors added inside the window, for the footnote; same rule as `boundaries`. */
  addedInWindow: AddedEntity[];
}

/**
 * Share of voice of one brand on one engine. It has no count of successes (its numerator is a sum of shares of one
 * answer each): `answers` is the denominator, the valid answers that name a tracked brand.
 */
export interface ShareFigure {
  /** `insufficient`: fewer than 4 answers name a tracked brand; `none`: no figure at all. */
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  numerator: number;
  answers: number;
}

/** Mentioned of one brand on one engine: `k` of `n` valid answers name it, prompt weighted in `value`. */
export interface MentionFigure {
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  k: number;
  n: number;
  /** The prompts with a valid answer that the rate is the mean over. */
  prompts: number;
}

export interface EntityFigures {
  entity: TrackedEntity;
  share: ShareFigure;
  mention: MentionFigure;
}

/** What one engine says of every tracked brand in one window. */
export interface EngineEntityTotals {
  status: 'read';
  engineCode: string;
  /** Every valid answer of the engine in the window, naming a tracked brand or not. */
  validAnswers: number;
  /** The denominator of every share of voice here. */
  answersNamingTracked: number;
  /** `ok`, `insufficient` or `none`, judged on `answersNamingTracked`. */
  state: RateState;
  /** The tracked set in its own order. */
  entities: EntityFigures[];
}

/** The summary does not carry what is asked: not asked for (`include`), not listed, or the rows were left out. */
export interface Unread {
  status: 'unread';
}

export type EntityTotals = EngineEntityTotals | Unread;

/** A pool of weeks behind a weekly point, for the tooltip (C-18). */
export interface PoolNote {
  /** The weeks pooled, 1 to 4. */
  weeks: number;
  /** The first and last day the pool covers. */
  from: string;
  to: string;
}

/** The share of one brand in one week. `numerator` is kept when `value` is null so a thin week can still be pooled. */
export interface WeeklyEntityShare {
  entityId: string;
  numerator: number;
  /** `null` when fewer than 4 answers name a tracked brand in the point. */
  value: number | null;
}

/** One weekly point of share of voice: every tracked brand, one denominator. */
export interface WeeklyPoint {
  /** The Monday the week starts on, in the project zone; the label of the point. */
  weekStart: string;
  /** The valid answers of the point that name a tracked brand: the denominator of its shares. */
  answers: number;
  state: RateState;
  /** `null` when the point holds only its own week. */
  pool: PoolNote | null;
  entities: WeeklyEntityShare[];
}

/** A weekly point with the brands past the palette folded into one. `other` is `null` when nothing is folded. */
export interface FoldedPoint {
  weekStart: string;
  answers: number;
  state: RateState;
  pool: PoolNote | null;
  /** The drawn brands in palette order (slot 1 first). */
  entities: WeeklyEntityShare[];
  /** The summed share of "Other tracked"; `null` when no brand is folded or the point has no share. */
  other: number | null;
}

/** The weekly mention rate of one brand: `k` of `n` answers, from the point's pooled counts. */
export interface WeeklyMention {
  entityId: string;
  state: RateState;
  value: number | null;
  k: number;
  n: number;
}

export interface WeeklyMentionPoint {
  weekStart: string;
  pool: PoolNote | null;
  entities: WeeklyMention[];
}

/** The rank of one brand in one week; `null` in a gap week (fewer than 4 answers name a tracked brand). */
export interface RankedEntity {
  entityId: string;
  rank: number | null;
  share: number | null;
  numerator: number;
}

export interface RankedWeek {
  weekStart: string;
  /** The answers the ranked shares are of (pooled when `poolWeeks` is set). */
  answers: number;
  /** The weeks pooled behind the shares; `null` when the week stands alone. */
  poolWeeks: number | null;
  entities: RankedEntity[];
}

export type WeeklyRead<T> = { status: 'read'; points: T[] } | Unread;

/** One competitor and the prompts it takes from the own brand on one engine (CH-05). */
export interface LostToRow {
  entityId: string;
  name: string;
  prompts: number;
}

export interface LostToResult {
  status: 'read';
  engineCode: string;
  /** The prompts with 4 or more valid answers: the "of 212" the card prints. */
  promptsWithEnoughAnswers: number;
  /** The prompts with 1 to 3 valid answers: counted, never lost. */
  promptsWithTooFewAnswers: number;
  /** Sorted by prompts, then name; competitors with no lost prompt are left out. */
  rows: LostToRow[];
}

export type LostToRead = LostToResult | Unread;

export type OpportunityKind = 'named_not_cited' | 'cited_not_named' | 'lost_to' | 'nobody_named';

/** One row of `ai.opportunities`: the prompts, each counted once, that meet a documented condition. */
export interface OpportunityRow {
  kind: OpportunityKind;
  /** The competitor of a `lost_to` row; `null` on the others. */
  entityId: string | null;
  name: string | null;
  prompts: number;
}

export interface OpportunityResult {
  status: 'read';
  /** The prompts with at least one valid answer on the engines in scope: the denominator of every row. */
  promptsInScope: number;
  rows: OpportunityRow[];
}

export type OpportunityRead = OpportunityResult | Unread;

/** One cell of the co-mention matrix: answers naming both brands, of the engine's valid answers. */
export interface CoMentionCell {
  rowId: string;
  columnId: string;
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  k: number;
  n: number;
}

export interface CoMentionMatrix {
  status: 'read';
  engineCode: string;
  /** The valid answers of the engine in scope. */
  answers: number;
  /** The brands drawn: own first, then by mention rate, at most 8; rows and columns have this order. */
  entities: TrackedEntity[];
  /** How many tracked brands are not drawn. */
  omitted: number;
  /** `cells[row][column]`; the diagonal is a brand with itself. */
  cells: CoMentionCell[][];
}

export type CoMentionRead = CoMentionMatrix | Unread;

export const UNREAD: Unread = { status: 'unread' };
