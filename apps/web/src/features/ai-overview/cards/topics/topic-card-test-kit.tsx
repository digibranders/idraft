import { http, HttpResponse, type RequestHandler } from 'msw';

import type { Phase, TopicData } from './model-types';
import type { OverviewScope } from '@/features/ai-overview';
import type { EngineSummary, PromptsSummary, PromptSummaryRow, Schemas, TopicSummaryRow } from '@/lib/api/types';

/*
 * Test support for the cards of the topics family (WP-36 plan section 2.8): small builders for the summary the
 * cards read, with counts that stay readable in a test, and the two routes a card's reads go through. Not shipped:
 * only `*.test.tsx` files import it.
 */

type MetricCell = Schemas['MetricCell'];
type WeekCells = Schemas['WeekCells'];
type PointPool = Schemas['PointPool'];

const SUMMARY = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary';
const VOCABULARIES = '/api/v1/workspaces/{workspace_id}/vocabularies';
const TERMS = '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms';

/** The window every fixture is of; `summaryOf` and the weeks use it. */
export const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' } as const;

export interface CellOptions {
  /** A topic cell weights prompts: its denominator is the prompts and `pooled` holds the answers k of n. */
  prompts?: number;
  /** The rate, when it is not k over n (a prompt weighted mean). */
  value?: number | null;
}

/**
 * A cell of k successes in n valid answers. With `prompts` it is a topic cell as the API sends it: the denominator
 * is the prompts, `pooled` the answers. With n of 0 it has no value (no valid answer is not a rate of 0).
 */
export function cell(k: number, n: number, { prompts, value }: CellOptions = {}): MetricCell {
  const rate = value === undefined ? (n === 0 ? null : k / n) : value;
  if (prompts === undefined) {
    return { numerator: k, denominator: n, n_observations: n, value: rate };
  }
  return {
    numerator: rate === null ? 0 : rate * prompts,
    denominator: prompts,
    n_observations: n,
    value: rate,
    pooled: { successes: k, trials: n },
  };
}

type Pair = readonly [k: number, n: number];

export interface WeekSpec {
  weekStart: string;
  /** The prompts that answered that week. */
  prompts: number;
  mentioned: Pair;
  cited?: Pair;
  sov?: Pair;
  /** A point that shows the weeks around it together. */
  pool?: { weeks: number; reason?: PointPool['reason']; belowPrompts?: number };
}

export interface EngineSpec {
  mentioned: Pair;
  cited?: Pair;
  sov?: Pair;
  /** Prompts weighted by each cell (a topic row); left out for a prompt row. */
  prompts?: number;
  series?: readonly WeekSpec[];
  /** The same cells over the compared window. */
  previous?: { mentioned: Pair; cited?: Pair; sov?: Pair; prompts?: number };
}

const NONE: Pair = [0, 0];
const OUTCOMES = {
  cited_only: cell(0, 0),
  mentioned_and_cited: cell(0, 0),
  mentioned_only: cell(0, 0),
  neither: cell(0, 0),
};

function weekOf(spec: WeekSpec): WeekCells {
  const { weekStart, prompts, pool } = spec;
  const one = (pair: Pair | undefined): MetricCell => cell(...(pair ?? NONE));
  return {
    week_start: weekStart,
    prompts,
    mentioned: one(spec.mentioned),
    cited: one(spec.cited),
    share_of_voice: one(spec.sov),
    is_pooled: pool !== undefined,
    pool:
      pool === undefined
        ? null
        : {
            weeks: pool.weeks,
            reason: pool.reason ?? 'few_prompts',
            below_prompts: pool.belowPrompts ?? 10,
            window: { ...WINDOW },
          },
  };
}

/** One engine's cells of a row. Counts are `[k, n]`; a part left out is a cell with no answer. */
export function engineCells(code: string, spec: EngineSpec): EngineSummary {
  const { prompts } = spec;
  const make = (pair: Pair | undefined, weight: number | undefined): MetricCell =>
    cell(...(pair ?? NONE), weight === undefined ? {} : { prompts: weight });
  const previous = spec.previous;
  return {
    engine_code: code,
    mentioned: make(spec.mentioned, prompts),
    cited: make(spec.cited, prompts),
    share_of_voice: make(spec.sov, prompts),
    outcomes: OUTCOMES,
    ...(previous === undefined
      ? {}
      : {
          previous: {
            mentioned: make(previous.mentioned, previous.prompts),
            cited: make(previous.cited, previous.prompts),
            share_of_voice: make(previous.sov, previous.prompts),
            outcomes: OUTCOMES,
          },
        }),
    ...(spec.series === undefined ? {} : { series: spec.series.map(weekOf) }),
  };
}

export function topicRow(
  id: string | null,
  name: string | null,
  promptCount: number,
  engines: EngineSummary[],
  lastValidAt: string | null = '2026-11-11T09:00:00Z',
): TopicSummaryRow {
  return {
    term_id: id,
    name,
    prompt_count: promptCount,
    engines,
    last_observed_at: lastValidAt,
    last_valid_at: lastValidAt,
  };
}

export function promptRow(
  id: string,
  text: string,
  topicIds: string[],
  engines: EngineSummary[],
  lastValidAt: string | null = '2026-11-11T09:00:00Z',
): PromptSummaryRow {
  return {
    prompt_id: id,
    text,
    topic_term_ids: topicIds,
    engines,
    is_branded: false,
    last_observed_at: lastValidAt,
    last_valid_at: lastValidAt,
  };
}

const CONTEXT = {
  method: 'ratio',
  metric: 'ai.mention_rate',
  prompt_rows: 'observation_weighted',
  topic_rows: 'prompt_weighted',
} as const;

export interface SummaryRows {
  topics?: TopicSummaryRow[];
  prompts?: PromptSummaryRow[];
  engineCodes?: string[];
  /** Adds a compare window so the response reads as one asked with `compare`. */
  compare?: { from: string; to: string };
}

export function summaryOf({ topics = [], prompts = [], engineCodes, compare }: SummaryRows): PromptsSummary {
  const codes =
    engineCodes ??
    [...new Set([...topics, ...prompts].flatMap((row) => row.engines.map((engine) => engine.engine_code)))].sort();
  return {
    window: { ...WINDOW },
    ...(compare === undefined ? {} : { compare_window: { ...compare, timezone: WINDOW.timezone } }),
    engine_codes: codes,
    include_branded: false,
    branded_only: false,
    entities: [],
    entity_config_versions: [1],
    metric_context: {
      mentioned: CONTEXT,
      cited: { ...CONTEXT, metric: 'ai.citation_rate' },
      share_of_voice: { ...CONTEXT, metric: 'ai.share_of_voice', prompt_rows: 'observation_weighted' },
      outcomes: { ...CONTEXT, metric: 'ai.outcomes' },
    },
    topics,
    prompts,
  };
}

/** An msw path for an API path template: `{workspace_id}` becomes `:workspace_id`, any origin. */
const routeOf = (path: string): string => `*${path.replace(/\{([^}]+)\}/g, ':$1')}`;

/**
 * The handler of `GET .../ai/prompts-summary`, for `server.use(summaryHandler(...))`. A function sees the request URL
 * (to read the `include`, `rows` and window keys, or to answer a failure); a summary is served as it is for every
 * request. The kit hands out handlers and never calls the server itself: a file outside `src/test` may not import it.
 */
export function summaryHandler(respond: PromptsSummary | ((url: URL) => PromptsSummary | Response)): RequestHandler {
  return http.get(routeOf(SUMMARY), ({ request }) => {
    const answer = typeof respond === 'function' ? respond(new URL(request.url)) : respond;
    return answer instanceof Response ? answer : HttpResponse.json({ data: answer });
  });
}

export interface TermSpec {
  id: string;
  name: string;
  /** The id of the term above it; `null` for a top level topic. */
  parent: string | null;
}

const VOCABULARY_ID = 'a0000000-0000-4000-8000-000000000001';

function treeOf(terms: readonly TermSpec[], parent: string | null, above: string): Schemas['TermNode'][] {
  return terms
    .filter((term) => term.parent === parent)
    .map((term) => {
      const path = `${above}/${term.name.toLowerCase().replaceAll(' ', '-')}`;
      return {
        term_id: term.id,
        vocabulary_id: VOCABULARY_ID,
        parent_id: term.parent,
        name: term.name,
        slug: term.name.toLowerCase().replaceAll(' ', '-'),
        path: path.slice(1),
        description: null,
        keyword_count: 0,
        prompt_count: null,
        source: 'manual',
        created_at: '2026-10-01T00:00:00Z',
        children: treeOf(terms, term.id, path),
      };
    });
}

/** The handlers of one topic vocabulary with these terms, so the tree of the cards knows the parents. */
export function vocabularyHandlers(terms: readonly TermSpec[]): RequestHandler[] {
  return [
    http.get(routeOf(VOCABULARIES), () =>
      HttpResponse.json({
        data: [
          {
            vocabulary_id: VOCABULARY_ID,
            project_id: null,
            name: 'Topics',
            kind: 'topic',
            is_hierarchical: true,
            is_single_valued: false,
            term_count: terms.length,
          },
        ],
        page: { offset: 0, limit: 200, total: 1 },
      }),
    ),
    http.get(routeOf(TERMS), () => HttpResponse.json({ data: treeOf(terms, null, '') })),
  ];
}

/**
 * A `TopicData` for the tests of the shell, which reads only the phase, the error and the scope: the rest is empty.
 * `scope` comes from `useOverview()` inside the card under test.
 */
export function topicData(scope: OverviewScope, over: Partial<TopicData> & { phase?: Phase } = {}): TopicData {
  return {
    phase: 'ready',
    stale: false,
    errorId: null,
    retry: () => undefined,
    paired: true,
    settled: true,
    compared: false,
    scope,
    engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
    summary: undefined,
    previous: null,
    nodes: [],
    previousNodes: null,
    prompts: [],
    previousPrompts: null,
    promptsRead: false,
    descendants: new Map(),
    tree: { pending: false, failed: false },
    aggregates: null,
    lastValidAt: null,
    ...over,
  };
}
