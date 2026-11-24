import type {
  EngineSummary,
  MetricCell,
  Prompt,
  PromptSummaryRow,
  PromptsSummary,
  Schemas,
  SummaryEntity,
  TopicSummaryRow,
} from '@/lib/api/types';

/**
 * The per-engine facts of the new Prompts columns, as the prompt summary read will carry them.
 *
 * BACKEND REQUEST SHAPE. The generated client (`lib/api/schema.ts`) does not carry any field of this file except the
 * intent enum, which `Prompt` already has, `latest`, `position`, `other_brands` and `top_links`. Each field is optional and means "the backend has not built it yet" when it
 * is absent; `null` means "the backend answered, and the value does not apply here" (an engine that does not classify
 * sentiment, a prompt with no linked keyword). The pure functions of this folder never turn either into a zero.
 * The exact names, shapes and owners are in `docs/ai-visibility/backend-requests-prompts-page.md`.
 */

/**
 * What an answer adds to its `ObservationFacts` for the prompt drawer (backend request 11): whether the answer recommends
 * the own brand and the place of the brand in a list the answer gives. Both optional: absent means the backend has not
 * built it, `null` means it does not apply (an engine that is not classified for recommendation, an answer that is not
 * a list). The drawer never turns either into a zero or a "No".
 */
export interface AnswerFactsExtra {
  /** The answer recommends the own brand; `null` on an engine whose answers are not classified for it. */
  recommended?: boolean | null;
  /** Place 1 of `listed` brands is the first of the list; `null` when the answer is not a list. */
  list_rank?: { place: number; listed: number } | null;
}

/** The facts of an answer with what the drawer reads beyond the generated type. */
export type ObservationFactsWithExtra = Schemas['ObservationFacts'] & AnswerFactsExtra;

/** The API's intent enum (`Prompt.intent`). */
export type PromptIntent = Prompt['intent'];

/** Who owns a cited domain, as the citations of an answer say it (`CitationOut.domain_role`). */
export type DomainRole = Schemas['CitationOut']['domain_role'];

/**
 * The keyword a prompt is linked to (WP-44, `prompt-links`) and its monthly searches. `search_volume` is null while the
 * keyword has no metrics yet.
 */
export interface LinkedKeywordVolume {
  keyword: string;
  search_volume: number | null;
  /**
   * The drawer's Related keywords card (backend request 12): where the keyword ranks in its latest rank check, `null`
   * when it is not in the first 20 results. Absent means the backend has not built it.
   */
  rank?: number | null;
  /**
   * What Google showed for the keyword in its latest rank check: `null` is no Google AI Overview on the results page;
   * `cited_position` is the place of the own site among the sources of the overview, `null` when it is not cited.
   * Absent means the backend has not built it.
   */
  ai_overview?: AiOverviewState | null;
}

/** A Google AI Overview in a rank check, and whether it cites the own site. */
export interface AiOverviewState {
  cited_position: number | null;
}

/**
 * Where the own brand sits in the ordered answers of one engine, as counts that add up over prompts: `rank_sum` of the
 * ranks of the mentions in an ordered list, `ordered_answers` of them, `mentions` of all valid answers that name the
 * brand, over `answers` valid answers. The mean position is `rank_sum / ordered_answers`, 1 being named first.
 */
/** The places of the own brand among the brands an answer names, as counts that add up over prompts. */
export interface OrderCounts {
  /** First, second, third, and fourth or later. */
  counts: readonly [number, number, number, number];
  /** The sum of the places of those answers, 1 being named first; the mean is this over the answers counted. */
  rank_sum: number;
}

export type PositionCounts = Schemas['PositionCounts'] & {
  /**
   * The order of the brands in the answers that name the own brand with a place (backend request 2 of
   * `docs/ai-visibility/backend-requests-overview.md`): how many name it first, second, third, and fourth or later, and
   * the sum of those places, so a mean and a distribution rest on the same answers. Optional: absent means the backend
   * has not built it, and the Overview position card then says so; a distribution is never made up from the mean.
   */
  by_order?: OrderCounts;
};

/** Counts of the classified mentions of the own brand by tone, on one engine. They add up to its classified mentions. */
export interface SentimentCounts {
  positive: number;
  neutral: number;
  negative: number;
  mixed: number;
}

export type SentimentKey = keyof SentimentCounts;

/** A brand other than the own that the answers named, with its Mentioned cell (`OtherBrand`). */
export type OtherBrand = Schemas['OtherBrand'];

/** A page cited by the answers of one engine, with how many of those answers cited it (`TopLink`). */
export type TopLink = Schemas['TopLink'];

/** The newest valid answer of the engine for a prompt row, with the state of its screenshot (`LatestAnswer`). */
export type LatestAnswer = Schemas['LatestAnswer'];

/**
 * Whether a screenshot of the answer can be had: `available` (stored, `screenshot_url` is its API path), `capturable`
 * (none yet, the provider can still make one), `expired` (none, and too late), `unsupported` (the engine has no
 * platform page to photograph).
 */
export type ScreenshotState = LatestAnswer['screenshot_state'];

/**
 * What an engine of a prompt row or a topic row adds to its `EngineSummary`. Tracked brands are not here: they are the
 * `entities` cells of `include=entities`.
 */
export interface EngineFacts {
  position?: PositionCounts | null;
  sentiment?: SentimentCounts | null;
  /** The recommendation rate: a cell like `mentioned`, null on an engine whose answers are not classified for it. */
  recommended?: MetricCell | null;
  other_brands?: OtherBrand[] | null;
  top_links?: TopLink[] | null;
  latest?: LatestAnswer | null;
}

export type EngineSummaryWithFacts = EngineSummary & EngineFacts;

/** What a prompt row adds: its intent and the keyword it is linked to (null: no link). */
export interface PromptRowFacts {
  intent?: PromptIntent;
  linked_keyword?: LinkedKeywordVolume | null;
}

/** What a topic row adds: the keywords its prompts are linked to, each once. */
export interface TopicRowFacts {
  linked_keywords?: LinkedKeywordVolume[] | null;
}

export type PromptSummaryRowWithFacts = Omit<PromptSummaryRow, 'engines' | 'linked_keyword'> &
  PromptRowFacts & { engines: EngineSummaryWithFacts[] };

export type TopicSummaryRowWithFacts = Omit<TopicSummaryRow, 'engines' | 'linked_keywords'> &
  TopicRowFacts & { engines: EngineSummaryWithFacts[] };

/**
 * The prompt summary read when it was asked for `include=entities,facts`. `entities` is optional: the Prompts page's own
 * read, which carries the weekly series, does not ask for the entity cells.
 */
export type PromptsSummaryWithFacts = Omit<PromptsSummary, 'prompts' | 'topics' | 'entities'> & {
  entities?: PromptsSummary['entities'];
  prompts: PromptSummaryRowWithFacts[];
  topics: TopicSummaryRowWithFacts[];
};

/** What the pure functions read of a row (a prompt row, a topic row, or the prompts of a topic). */
export interface FactsRow {
  engines: readonly EngineSummaryWithFacts[];
}

/** A tracked entity of the summary (`PromptsSummary.entities`). */
export type TrackedEntity = SummaryEntity;
