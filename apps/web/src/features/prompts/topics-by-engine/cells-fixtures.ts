import type { TopicHead } from './topic-rows';
import type {
  EngineSummary,
  EntityCells,
  MetricCell,
  PointPool,
  PromptSummaryRow,
  ProjectEngine,
  SummaryEntity,
  TopicSummaryRow,
  WeekCells,
} from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * Builders for the tests of this folder: the cells of the prompts summary written as counts, so a test reads as
 * "3 of 8 answers" and not as a pile of fields.
 */

/** `k` of `n` valid answers, as a prompt's cell counts them; `value` is null with no valid answer. */
export const cell = (k: number, n: number, observations: number = n): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: k,
  denominator: n,
  n_observations: observations,
  pooled: null,
});

/**
 * A topic's prompt weighted cell: `k` of `n` valid answers behind it, `prompts` prompts weighted. Its numerator is
 * the sum of the prompts' rates, so it is not whole in general (`weighted(1, 3, 2)` has numerator 2/3).
 */
export const weighted = (k: number, n: number, prompts: number, observations: number = n): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: n === 0 ? 0 : (k / n) * prompts,
  denominator: prompts,
  n_observations: observations,
  pooled: { successes: k, trials: n },
});

const NO_CELL = cell(0, 0);

export interface EngineCells {
  mentioned?: MetricCell;
  cited?: MetricCell;
  share_of_voice?: MetricCell;
  series?: WeekCells[] | null;
  entities?: EntityCells[] | null;
  /** The same cells over the compared window. */
  previous?: { mentioned?: MetricCell; cited?: MetricCell; share_of_voice?: MetricCell } | null;
}

const NO_OUTCOMES = { mentioned_and_cited: NO_CELL, mentioned_only: NO_CELL, cited_only: NO_CELL, neither: NO_CELL };

/** An engine's summary; a metric left out has no answer at all. */
export const engine = (code: string, cells: EngineCells = {}): EngineSummary => ({
  engine_code: code,
  mentioned: cells.mentioned ?? NO_CELL,
  cited: cells.cited ?? NO_CELL,
  share_of_voice: cells.share_of_voice ?? NO_CELL,
  outcomes: NO_OUTCOMES,
  ...(cells.series === undefined ? {} : { series: cells.series }),
  ...(cells.entities === undefined ? {} : { entities: cells.entities }),
  ...(cells.previous === undefined
    ? {}
    : {
        previous:
          cells.previous === null
            ? null
            : {
                mentioned: cells.previous.mentioned ?? NO_CELL,
                cited: cells.previous.cited ?? NO_CELL,
                share_of_voice: cells.previous.share_of_voice ?? NO_CELL,
                outcomes: NO_OUTCOMES,
              },
      }),
});

/** A tracked entity's cells: its Mentioned and its share of voice. */
export const entityCells = (entityId: string, mentioned: MetricCell, share: MetricCell = NO_CELL): EntityCells => ({
  entity_id: entityId,
  mentioned,
  share_of_voice: share,
});

export const own = (entityId: string, name: string = 'Acme'): SummaryEntity => ({
  entity_id: entityId,
  name,
  role: 'own',
});

export const competitor = (entityId: string, name: string): SummaryEntity => ({
  entity_id: entityId,
  name,
  role: 'competitor',
});

/** What a pooled point holds: `weeks` weeks ending in the window `from` to `to`. */
export const pool = (weeks: number, from: string, to: string): PointPool => ({
  below_prompts: 10,
  reason: 'few_prompts',
  weeks,
  window: { from, to, timezone: 'UTC' },
});

export interface WeekCellsInput {
  mentioned?: MetricCell;
  cited?: MetricCell;
  share_of_voice?: MetricCell;
  prompts?: number;
  /** Present: the point is pooled. */
  pool?: PointPool;
  entities?: EntityCells[] | null;
}

/** One weekly point of a series. */
export const week = (weekStart: string, input: WeekCellsInput = {}): WeekCells => ({
  week_start: weekStart,
  prompts: input.prompts ?? 0,
  is_pooled: input.pool !== undefined,
  ...(input.pool === undefined ? {} : { pool: input.pool }),
  mentioned: input.mentioned ?? NO_CELL,
  cited: input.cited ?? NO_CELL,
  share_of_voice: input.share_of_voice ?? NO_CELL,
  ...(input.entities === undefined ? {} : { entities: input.entities }),
});

const ENGINE_LABELS = { chatgpt_web: 'ChatGPT', gemini_web: 'Gemini', google_ai_mode: 'Google AI Mode' } as const;

/** A project engine of the three the mocks know. */
export const projectEngine = (code: keyof typeof ENGINE_LABELS): ProjectEngine => ({
  active_prompts: 1,
  engine: {
    engine_code: code,
    label: ENGINE_LABELS[code],
    observation_class: 'consumer_ui',
    vendor: 'openai',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: 2000,
  },
  estimated_monthly_cost_usd: null,
  is_configured: true,
  is_enabled: true,
  location_ids: [2276],
  provider_code: 'openai',
  replicates: 1,
});

/** A term of the topic tree. */
export const term = (termId: string, name: string, parentId: string | null = null, path: string = name): NamedTerm => ({
  termId,
  name,
  parentId,
  path,
});

/** A topic row of the summary; `termId` null is the row of the prompts without a topic. */
export const topicRow = (
  termId: string | null,
  name: string | null,
  promptCount: number,
  engines: readonly EngineSummary[] = [],
): TopicSummaryRow => ({
  term_id: termId,
  name,
  prompt_count: promptCount,
  engines: [...engines],
  last_observed_at: null,
  last_valid_at: null,
});

/** A prompt row of the summary. */
export const promptRow = (
  promptId: string,
  text: string,
  topicTermIds: readonly string[],
  engines: readonly EngineSummary[] = [],
): PromptSummaryRow => ({
  prompt_id: promptId,
  text,
  is_branded: false,
  topic_term_ids: [...topicTermIds],
  engines: [...engines],
  last_observed_at: null,
  last_valid_at: null,
});

/** A topic head as the heat map, the export and the phone list read it. */
export const head = (key: string, name: string, over: Partial<TopicHead> = {}): TopicHead => ({
  key,
  name,
  path: name,
  parent: null,
  promptCount: 1,
  engines: [],
  members: null,
  children: [],
  ...over,
});
