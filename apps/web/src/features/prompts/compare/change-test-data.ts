import type { EngineSummary, MetricCell, ProjectEngine, Schemas } from '@/lib/api/types';
import type { StripPrompt } from '@/lib/rates/strip-model';

/**
 * Cells for the tests of the change on the strip and the Mention rate column: an engine that answered `now` (k of n
 * valid answers) and, unless `before` is null, `before` in the window before. Test data only.
 */

type EngineCells = Schemas['EngineCells'];
type EngineCode = Schemas['EngineCode'];

export const cell = (k: number, n: number): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: k,
  denominator: n,
  n_observations: n,
  pooled: null,
});

/** A topic's cell: `k` of `n` answers pooled behind a rate over `prompts` prompts. */
export const topicCell = (k: number, n: number, prompts: number): MetricCell => ({
  value: k / n,
  numerator: 0,
  denominator: prompts,
  n_observations: n,
  pooled: { successes: k, trials: n },
});

const EMPTY = cell(0, 0);
const OUTCOMES = { cited_only: EMPTY, mentioned_and_cited: EMPTY, mentioned_only: EMPTY, neither: EMPTY };

export const cellsOf = (mentioned: MetricCell, shareOfVoice: MetricCell = EMPTY): EngineCells => ({
  mentioned,
  cited: EMPTY,
  share_of_voice: shareOfVoice,
  outcomes: OUTCOMES,
});

/** An engine's cells; `shares` are its share of voice cells now and before (empty where not given). */
export const engineOf = (
  code: string,
  now: MetricCell,
  before: MetricCell | null,
  shares: readonly [MetricCell, MetricCell] = [EMPTY, EMPTY],
): EngineSummary => ({
  engine_code: code,
  ...cellsOf(now, shares[0]),
  previous: before === null ? null : cellsOf(before, shares[1]),
});

/** 30 of 60 against 12 of 60: larger than normal variation. */
export const DETECTABLE: readonly [MetricCell, MetricCell] = [cell(30, 60), cell(12, 60)];
/** 31 of 60 against 27 of 60: within normal variation. */
export const WITHIN: readonly [MetricCell, MetricCell] = [cell(31, 60), cell(27, 60)];

/** The prompts of a chip: each prompt answered once per engine, so the chip's figures are the mean of the cells. */
export const promptsOf = (...cells: readonly (readonly [MetricCell, MetricCell | null])[]): StripPrompt[] =>
  cells.map(([now, before]) => ({ topic_term_ids: [], engines: [engineOf('chatgpt_web', now, before)] }));

const LABELS: Readonly<Record<EngineCode, string>> = {
  chatgpt_web: 'ChatGPT',
  gemini_web: 'Gemini',
  google_ai_mode: 'Google AI Mode',
};

export const projectEngine = (code: EngineCode): ProjectEngine => ({
  active_prompts: 1,
  engine: {
    engine_code: code,
    label: LABELS[code],
    observation_class: 'consumer_ui',
    vendor: 'test',
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
