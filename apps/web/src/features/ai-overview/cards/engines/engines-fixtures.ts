import type {
  EngineCode,
  EngineSummary,
  MetricCell,
  PointPool,
  PromptsSummary,
  PromptSummaryRow,
  WeekCells,
} from '@/lib/api/types';

/**
 * Builders for the tests of the engines family: the cells of the prompts summary written as counts, so a test reads
 * "3 of 8 answers" and not as a pile of fields. Not imported by any card.
 */

/** `k` of `n` valid answers, and optionally the answers observed (the valid ones and those that were not). */
export type Counts = readonly [k: number, n: number, observations?: number];

/** `k` of `n` valid answers as a prompt's cell counts them; `value` is null with no valid answer. */
export const cell = (k: number, n: number, observations: number = n): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: k,
  denominator: n,
  n_observations: observations,
  pooled: null,
});

const NO_CELL = cell(0, 0);
const cellOf = (counts: Counts | undefined): MetricCell =>
  counts === undefined ? NO_CELL : cell(counts[0], counts[1], counts[2]);

export interface EngineCellsInput {
  mentioned?: Counts;
  cited?: Counts;
  shareOfVoice?: Counts;
  outcomes?: Partial<Record<'mentionedAndCited' | 'mentionedOnly' | 'citedOnly' | 'neither', Counts>>;
  series?: WeekCells[];
}

/** An engine's cells of one prompt; a metric left out has no answer at all, never a zero rate. */
export function engineCells(code: EngineCode, input: EngineCellsInput = {}): EngineSummary {
  const { outcomes = {} } = input;
  return {
    engine_code: code,
    mentioned: cellOf(input.mentioned),
    cited: cellOf(input.cited),
    share_of_voice: cellOf(input.shareOfVoice),
    outcomes: {
      mentioned_and_cited: cellOf(outcomes.mentionedAndCited),
      mentioned_only: cellOf(outcomes.mentionedOnly),
      cited_only: cellOf(outcomes.citedOnly),
      neither: cellOf(outcomes.neither),
    },
    ...(input.series === undefined ? {} : { series: input.series }),
  };
}

/** A prompt row of the summary. */
export function promptRow(
  promptId: string,
  engines: readonly EngineSummary[],
  over: { text?: string; branded?: boolean; topics?: readonly string[] } = {},
): PromptSummaryRow {
  return {
    prompt_id: promptId,
    text: over.text ?? `Prompt ${promptId}`,
    is_branded: over.branded ?? false,
    topic_term_ids: [...(over.topics ?? [])],
    engines: [...engines],
    last_observed_at: null,
    last_valid_at: null,
  };
}

export interface WeekInput {
  mentioned?: Counts;
  cited?: Counts;
  shareOfVoice?: Counts;
  prompts?: number;
  /** Present: the point is pooled over the weeks it names. */
  pool?: PointPool;
}

/** One weekly point of an engine's series. */
export const week = (weekStart: string, input: WeekInput = {}): WeekCells => ({
  week_start: weekStart,
  prompts: input.prompts ?? 0,
  is_pooled: input.pool !== undefined,
  ...(input.pool === undefined ? {} : { pool: input.pool }),
  mentioned: cellOf(input.mentioned),
  cited: cellOf(input.cited),
  share_of_voice: cellOf(input.shareOfVoice),
});

const CONTEXT = {
  method: 'rate',
  metric: 'mention_rate',
  prompt_rows: 'prompt_weighted',
  topic_rows: 'prompt_weighted',
} as const;

/** A summary of prompt rows over Oct 16 to Nov 12 (the window of the strip's own tests); topics and total are empty. */
export function summaryOf(
  prompts: readonly PromptSummaryRow[],
  over: { codes?: readonly string[]; window?: { from: string; to: string } } = {},
): PromptsSummary {
  const { codes = ['chatgpt_web'], window = { from: '2026-10-16', to: '2026-11-12' } } = over;
  return {
    branded_only: false,
    engine_codes: [...codes],
    entities: [],
    entity_config_versions: [],
    include_branded: false,
    metric_context: { mentioned: CONTEXT, cited: CONTEXT, outcomes: CONTEXT, share_of_voice: CONTEXT },
    prompts: [...prompts],
    topics: [],
    window: { ...window, timezone: 'UTC' },
  };
}

/**
 * The summary with the tracked brands and a `total` row whose engines carry the entity cells share of voice is counted
 * from (D17): `counts` is, per engine, the mentions of the own brand and of one competitor, so x is the first and y both.
 */
export function withBrandMentions(
  summary: PromptsSummary,
  counts: Readonly<Record<string, readonly [own: number, rival: number]>>,
): PromptsSummary {
  const engines = Object.entries(counts).flatMap(([code, [own, rival]]) => {
    const base = summary.prompts.flatMap((prompt) => prompt.engines).find((engine) => engine.engine_code === code);
    if (base === undefined) return [];
    const entity = (id: string, mentions: number): NonNullable<EngineSummary['entities']>[number] => ({
      entity_id: id,
      mentioned: cell(mentions, 20),
      share_of_voice: cell(0, 0),
    });
    return [{ ...base, entities: [entity('e-own', own), entity('e-rival', rival)] }];
  });
  return {
    ...summary,
    entities: [
      { entity_id: 'e-own', name: 'Northwind', role: 'own' },
      { entity_id: 'e-rival', name: 'Rival', role: 'competitor' },
    ],
    total: { engines, last_observed_at: null, last_valid_at: null, prompt_count: summary.prompts.length },
  };
}
