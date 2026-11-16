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
 * intent enum, which `Prompt` already has. Each field is optional and means "the backend has not built it yet" when it
 * is absent; `null` means "the backend answered, and the value does not apply here" (an engine that does not classify
 * sentiment, a prompt with no linked keyword). The pure functions of this folder never turn either into a zero.
 * The exact names, shapes and owners are in `docs/ai-visibility/backend-requests-prompts-page.md`.
 */

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
}

/**
 * Where the own brand sits in the ordered answers of one engine, as counts that add up over prompts: `rank_sum` of the
 * ranks of the mentions in an ordered list, `ordered_answers` of them, `mentions` of all valid answers that name the
 * brand, over `answers` valid answers. The mean position is `rank_sum / ordered_answers`, 1 being named first.
 */
export interface PositionCounts {
  rank_sum: number;
  ordered_answers: number;
  mentions: number;
  answers: number;
  /**
   * How many of the ordered answers name the brand first, second, third, and fourth or later (backend request 2 of
   * `docs/ai-visibility/backend-requests-overview.md`). Optional: absent means the backend has not built it, and the
   * Overview position card then says so; a distribution is never made up from the mean. They add up to `ordered_answers`.
   */
  by_order?: readonly [number, number, number, number];
}

/** Counts of the classified mentions of the own brand by tone, on one engine. They add up to its classified mentions. */
export interface SentimentCounts {
  positive: number;
  neutral: number;
  negative: number;
  mixed: number;
}

export type SentimentKey = keyof SentimentCounts;

/** A brand the answers named that is not a tracked entity: its Mentioned cell, built as the tracked entities' cells are. */
export interface OtherBrand {
  name: string;
  mentioned: MetricCell;
}

/** A page cited by the answers of one engine, with how many of those answers cited it. */
export interface TopLink {
  url: string;
  domain: string;
  domain_role: DomainRole;
  answers: number;
}

/** The newest answer of the engine for the row. `screenshot_url` is null when no screenshot was captured. */
export interface LatestAnswer {
  observation_id: string;
  observed_at: string;
  screenshot_url: string | null;
}

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
  linked_keywords?: LinkedKeywordVolume[];
}

export type PromptSummaryRowWithFacts = Omit<PromptSummaryRow, 'engines'> &
  PromptRowFacts & { engines: EngineSummaryWithFacts[] };

export type TopicSummaryRowWithFacts = Omit<TopicSummaryRow, 'engines'> &
  TopicRowFacts & { engines: EngineSummaryWithFacts[] };

/** The prompt summary read when it was asked for `include=entities,facts`. */
export type PromptsSummaryWithFacts = Omit<PromptsSummary, 'prompts' | 'topics'> & {
  prompts: PromptSummaryRowWithFacts[];
  topics: TopicSummaryRowWithFacts[];
};

/** What the pure functions read of a row (a prompt row, a topic row, or the prompts of a topic). */
export interface FactsRow {
  engines: readonly EngineSummaryWithFacts[];
}

/** A tracked entity of the summary (`PromptsSummary.entities`). */
export type TrackedEntity = SummaryEntity;
