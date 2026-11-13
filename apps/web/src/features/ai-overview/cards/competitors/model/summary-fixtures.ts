import type {
  EngineSummary,
  EntityCells,
  MetricCell,
  PointPool,
  ProjectEntity,
  PromptsSummary,
  PromptSummaryRow,
  Schemas,
  SummaryEntity,
  WeekCells,
} from '@/lib/api/types';

/**
 * Builders of `PromptsSummary` for the tests of the competitors model: cells written as counts, so a test reads
 * "3 of 8 answers". Every builder returns the schema type, so a field the API adds breaks here and not silently.
 */

type MetricContext = Schemas['MetricContext'];
type OutcomeCells = Schemas['OutcomeCells'];

/** The item at `index`, or a failed test: indexing under `noUncheckedIndexedAccess` without a non-null assertion. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item at index ${index} of ${items.length}`);
  return item;
}

/** A readable uuid: `id(1)` is the own brand of most tests, `id(2)` and up its competitors. */
export const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const own = (n: number = 1, name: string = 'Fynix'): SummaryEntity => ({
  entity_id: id(n),
  name,
  role: 'own',
});

export const competitor = (n: number, name: string): SummaryEntity => ({
  entity_id: id(n),
  name,
  role: 'competitor',
});

/** `k` of `n` valid answers, as a prompt's cell counts them. */
export const cell = (k: number, n: number, observations: number = n): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: k,
  denominator: n,
  n_observations: observations,
  pooled: null,
});

/**
 * A prompt weighted cell of a total or topic row: its numerator is the sum of the prompts' own rates (`rates`),
 * its denominator the prompts, and `pooled` holds the answers behind it (`k` of `n`).
 */
export const weighted = (k: number, n: number, rates: readonly number[]): MetricCell => {
  const numerator = rates.reduce((sum, rate) => sum + rate, 0);
  return {
    value: rates.length === 0 ? null : numerator / rates.length,
    numerator,
    denominator: rates.length,
    n_observations: n,
    pooled: { successes: k, trials: n },
  };
};

/** A share of voice cell: the numerator is a sum of shares of one answer each, so it need not be whole. */
export const share = (numerator: number, denominator: number): MetricCell => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
  n_observations: denominator,
  pooled: null,
});

export const entityCells = (
  entity: SummaryEntity | string,
  mentioned: MetricCell,
  shareCell: MetricCell,
): EntityCells => ({
  entity_id: typeof entity === 'string' ? entity : entity.entity_id,
  mentioned,
  share_of_voice: shareCell,
});

export interface OutcomeCounts {
  mentionedOnly?: MetricCell;
  citedOnly?: MetricCell;
  mentionedAndCited?: MetricCell;
  neither?: MetricCell;
}

const NONE = cell(0, 0);

export function outcomes(counts: OutcomeCounts = {}): OutcomeCells {
  return {
    mentioned_only: counts.mentionedOnly ?? NONE,
    cited_only: counts.citedOnly ?? NONE,
    mentioned_and_cited: counts.mentionedAndCited ?? NONE,
    neither: counts.neither ?? NONE,
  };
}

export interface EngineInput {
  /** The own brand's Mentioned. */
  mentioned?: MetricCell;
  cited?: MetricCell;
  /** The engine's share of voice cell: its denominator is the answers that name a tracked brand. */
  share?: MetricCell;
  outcomes?: OutcomeCounts;
  entities?: EntityCells[];
  series?: WeekCells[];
}

export function engine(code: string, input: EngineInput = {}): EngineSummary {
  return {
    engine_code: code,
    mentioned: input.mentioned ?? NONE,
    cited: input.cited ?? NONE,
    share_of_voice: input.share ?? NONE,
    outcomes: outcomes(input.outcomes),
    ...(input.entities === undefined ? {} : { entities: input.entities }),
    ...(input.series === undefined ? {} : { series: input.series }),
  };
}

export const promptRow = (promptId: number, engines: EngineSummary[]): PromptSummaryRow => ({
  prompt_id: id(1000 + promptId),
  text: `Prompt ${promptId}`,
  topic_term_ids: [],
  is_branded: false,
  last_observed_at: null,
  last_valid_at: null,
  engines,
});

export const pool = (weeks: number, from: string, to: string): PointPool => ({
  below_prompts: 10,
  reason: 'few_prompts',
  weeks,
  window: { from, to, timezone: 'UTC' },
});

export interface WeekInput {
  /** The point's share of voice cell; its denominator is the answers naming a tracked brand. */
  share?: MetricCell;
  mentioned?: MetricCell;
  prompts?: number;
  entities?: EntityCells[];
  pool?: PointPool;
}

export const week = (weekStart: string, input: WeekInput = {}): WeekCells => ({
  week_start: weekStart,
  prompts: input.prompts ?? 12,
  is_pooled: input.pool !== undefined,
  ...(input.pool === undefined ? {} : { pool: input.pool }),
  mentioned: input.mentioned ?? NONE,
  cited: NONE,
  share_of_voice: input.share ?? NONE,
  ...(input.entities === undefined ? {} : { entities: input.entities }),
});

const context = (metric: string): MetricContext => ({
  metric,
  method: 'fixture',
  prompt_rows: 'observation_weighted',
  topic_rows: 'prompt_weighted',
});

export interface ProjectEntityInput {
  role?: 'own' | 'competitor' | 'watch';
  colorIndex?: number | null;
  addedAt?: string;
  removedAt?: string | null;
}

/** One row of `GET {P}/entities`: the colour and the day the brand joined the project. */
export function projectEntity(n: number, name: string, input: ProjectEntityInput = {}): ProjectEntity {
  const role = input.role ?? 'competitor';
  const colorIndex = input.colorIndex ?? null;
  return {
    project_id: id(9000),
    role,
    is_primary: role === 'own',
    track_ai: true,
    track_seo: false,
    color_index: colorIndex,
    added_at: input.addedAt ?? '2026-01-05T09:00:00Z',
    removed_at: input.removedAt ?? null,
    alias_count: 0,
    domains: [],
    entity: {
      entity_id: id(n),
      canonical_name: name,
      color_index: colorIndex,
      entity_type: 'brand',
      role,
    },
  };
}

export const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };

export interface SummaryInput {
  entities?: SummaryEntity[];
  prompts?: PromptSummaryRow[];
  /** The engines of the `total` block: present means the read asked for `include=total`. */
  total?: EngineSummary[];
  coMentions?: Schemas['EngineCoMentions'][];
  versions?: number[];
  window?: { from: string; to: string; timezone: string };
}

export function summaryOf(input: SummaryInput = {}): PromptsSummary {
  const engines = input.total ?? input.prompts?.flatMap((prompt) => prompt.engines) ?? [];
  return {
    branded_only: false,
    include_branded: false,
    engine_codes: [...new Set(engines.map((entry) => entry.engine_code))],
    entities: input.entities ?? [own(), competitor(2, 'HubSpot'), competitor(3, 'Zoho')],
    entity_config_versions: input.versions ?? [1],
    metric_context: {
      mentioned: context('mentioned'),
      cited: context('cited'),
      outcomes: context('outcomes'),
      share_of_voice: context('share_of_voice'),
    },
    prompts: input.prompts ?? [],
    topics: [],
    window: input.window ?? WINDOW,
    ...(input.total === undefined
      ? {}
      : {
          total: {
            engines: input.total,
            last_observed_at: null,
            last_valid_at: null,
            prompt_count: input.prompts?.length ?? 0,
          },
        }),
    ...(input.coMentions === undefined ? {} : { co_mentions: input.coMentions }),
  };
}
