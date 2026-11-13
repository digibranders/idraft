import { promptsInScope, topicsInScope } from './topics-in-scope';
import type { EngineCode, ProjectEngine, PromptsSummary, PromptSummaryRow, Schemas } from '@/lib/api/types';
import { ENGINES } from '@/lib/layouts/catalog';
import { engineRates, type RateFigure } from '@/lib/rates/strip-model';
import { isDetectableChange, rateState, type RateState } from '@/lib/stats';

/**
 * What the numbers and the cards of the AI visibility Overview need, as plain data (WP-33 plan sections 3.3 and
 * 3.4). It is a pure function of the reads: `buildAggregates` is the WP-32 seam, so when the aggregate routes are
 * built only it and the hooks change, and `OverviewAggregates` stays.
 *
 * One denominator per number (R12): the rates are the Topics and Prompts strip's own (`engineRates`), over the
 * same prompt rows, so the Overview and that page show the same figure and the same counts for the same scope.
 * Unknown is never zero: an engine that was not asked, has no answer or has too few valid ones has no value, and
 * says why. Engines are never pooled: every figure is of one engine, in the fixed order of the catalog.
 */

/** A rate of one engine and the counts behind it: `successes` of `answers`, over `prompts` prompts each counted once. */
export type RateCount = RateFigure;

/** A share of counts that are not answers (citation units) or not of the prompt rows (fan-out), with `k` of `n`. */
export interface CountRate {
  /** `ok` from `MIN_OBSERVATIONS` counted, `insufficient` under, `none` with nothing to count. */
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  k: number;
  n: number;
}

/**
 * The change of a rate between the windows. `delta` is on the 0 to 1 scale (0.05 is 5 points: `formatPointsDelta`
 * takes it as it is) and `null` when either window has no rate. `detectable` is the unpaired test on the pooled
 * counts (`isDetectableChange`), `null` where there is no test: share of voice, and a change without a rate on
 * both sides. Colour a change only when it is `true`.
 */
export interface Change {
  delta: number | null;
  detectable: boolean | null;
}

/** Everything the page says of one engine in one window. */
export interface Figures {
  mentioned: RateCount;
  cited: RateCount;
  mentionedAndCited: RateCount;
  shareOfVoice: RateCount;
  /** The valid answers: the denominator of the rates. */
  validAnswers: number;
  /** Every answer, valid or not: `allAnswers - validAnswers` are not valid. */
  allAnswers: number;
}

/** Why an engine is or is not read: it is `asked`, or off in the project, or left out of the engine filter. */
export type EngineAvailability = 'asked' | 'outsideFilter' | 'off';

export interface EngineAggregate extends Figures {
  engineCode: EngineCode;
  label: string;
  /** Enabled and inside the engine filter. An engine that is not asked has no figures, and its numbers say why. */
  asked: boolean;
  availability: EngineAvailability;
  /** The same figures of the window before; `null` with the comparison off and when that window has no answer. */
  previous: Figures | null;
  change: { mentioned: Change; cited: Change; mentionedAndCited: Change; shareOfVoice: Change };
  /** Own citation units over all citation units; `null` while that read is absent, and for an engine it does not list. */
  citationShare: CountRate | null;
  /** `exposed` is false for an engine that does not show its fan-out; `presence` is `null` while unknown. */
  fanout: { exposed: boolean; presence: CountRate | null };
}

export interface OverviewAggregates {
  /** The prompts in scope, once. */
  promptCount: number;
  /** The topics they span; `null` while the topic rows are absent. */
  topicCount: number | null;
  /** ChatGPT, Gemini, AI Mode, in that order; every engine of the catalog, asked or not. */
  engines: EngineAggregate[];
  lastValidAt: string | null;
  lastObservedAt: string | null;
  /** The valid answers of the previous window on the engines asked: 0 means it has no data; `null` with no comparison. */
  previousAnswers: number | null;
}

export interface AggregateInputs {
  current: PromptsSummary;
  /** The summary of the window before; `null` when the comparison is off or its window cannot be asked. */
  previous: PromptsSummary | null;
  /** The engines of the project, enabled or not. */
  engines: readonly ProjectEngine[];
  /** The engine filter of the scope (`scope.engines`): `null` for every enabled engine. */
  chosenEngines: readonly string[] | null;
  /** The chosen topic and the topics below it (the term ids), or `null` for all topics. */
  topicsKept: ReadonlySet<string> | null;
  /** The meta of the sources read; `null` while it is absent, failed, or cannot answer the scope. */
  sources: Schemas['SourcesMeta'] | null;
  /** The meta of the fan-out read; `null` as above. */
  fanout: Schemas['FanoutMeta'] | null;
}

const NO_RATE: RateCount = { state: 'none', value: null, answers: 0, successes: null, prompts: 0, reason: 'noAnswers' };
const NO_FIGURES: Figures = {
  mentioned: NO_RATE,
  cited: NO_RATE,
  mentionedAndCited: NO_RATE,
  shareOfVoice: NO_RATE,
  validAnswers: 0,
  allAnswers: 0,
};
const NO_CHANGE: Change = { delta: null, detectable: null };

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** The newest of ISO times; `null` when there is none. */
function newest(times: readonly (string | null)[]): string | null {
  let best: { text: string; time: number } | null = null;
  for (const text of times) {
    const time = text === null ? Number.NaN : Date.parse(text);
    if (text !== null && !Number.isNaN(time) && (best === null || time > best.time)) best = { text, time };
  }
  return best?.text ?? null;
}

/** The figures of one engine over the prompt rows of one window. */
function figuresOf(prompts: readonly PromptSummaryRow[], code: EngineCode): Figures {
  const { mentioned, cited, shareOfVoice } = engineRates(prompts, code);
  // Named and cited is prompt weighted like Mentioned: the strip's own arithmetic over the outcome cell
  const outcome = prompts.map((prompt) => ({
    topic_term_ids: prompt.topic_term_ids,
    engines: prompt.engines
      .filter((engine) => engine.engine_code === code)
      .map((engine) => ({ ...engine, mentioned: engine.outcomes.mentioned_and_cited })),
  }));
  return {
    mentioned,
    cited,
    shareOfVoice,
    mentionedAndCited: engineRates(outcome, code).mentioned,
    validAnswers: mentioned.answers,
    allAnswers: sum(
      prompts.flatMap((prompt) =>
        prompt.engines.filter((engine) => engine.engine_code === code).map((engine) => engine.mentioned.n_observations),
      ),
    ),
  };
}

/**
 * Whether the change between two rates is detectable, by the unpaired test on the pooled counts. The change shown
 * is of the prompt weighted rates and the test reads the pooled counts: when they point apart the test would answer
 * another question than the change states, so there is no claim.
 */
function detectableOf(now: RateCount, before: RateCount, delta: number): boolean | null {
  if (now.successes === null || before.successes === null) return null;
  const detectable = isDetectableChange(
    { k: now.successes, n: now.answers },
    { k: before.successes, n: before.answers },
  );
  if (detectable === null) return null;
  const pooled = now.successes / now.answers - before.successes / before.answers;
  return delta !== 0 && Math.sign(pooled) !== Math.sign(delta) ? null : detectable;
}

function changeOf(now: RateCount, before: RateCount | undefined, tested: boolean): Change {
  if (before === undefined || now.value === null || before.value === null) return NO_CHANGE;
  const delta = now.value - before.value;
  return { delta, detectable: tested ? detectableOf(now, before, delta) : null };
}

function countRate(k: number, n: number): CountRate {
  const state = rateState(n);
  return { state, value: state === 'ok' ? k / n : null, k, n };
}

/** Own citation units over every citation unit of the engine, from the sources read's by engine block. */
function citationShareOf(sources: Schemas['SourcesMeta'] | null, code: EngineCode): CountRate | null {
  const roles = sources?.by_role_by_engine?.find((entry) => entry.engine_code === code);
  if (roles === undefined) return null;
  const own = roles.own.citation_units;
  return countRate(own, own + roles.competitor.citation_units + roles.third_party.citation_units);
}

/**
 * The fan-out presence of one engine. The read answers for the engines it names together, so it belongs to an
 * engine only when that engine is the one it names: a read over two engines is no engine's own figure.
 */
function fanoutOf(
  fanout: Schemas['FanoutMeta'] | null,
  project: ProjectEngine | undefined,
  code: EngineCode,
): EngineAggregate['fanout'] {
  const without = fanout?.engines_without_fanout ?? [];
  const exposed = project?.engine.exposes_fanout === true && !without.includes(code);
  if (!exposed || fanout === null) return { exposed, presence: null };
  const showing = fanout.engine_codes.filter((entry) => !without.includes(entry));
  const own = showing.length === 1 && showing[0] === code;
  return { exposed, presence: own ? countRate(fanout.answers_with_fanout, fanout.answers) : null };
}

function availabilityOf(
  project: ProjectEngine | undefined,
  code: EngineCode,
  chosen: readonly string[] | null,
): EngineAvailability {
  if (project?.is_enabled !== true) return 'off';
  return chosen === null || chosen.includes(code) ? 'asked' : 'outsideFilter';
}

function engineAggregate(inputs: AggregateInputs, code: EngineCode, label: string): EngineAggregate {
  const project = inputs.engines.find((entry) => entry.engine.engine_code === code);
  const availability = availabilityOf(project, code, inputs.chosenEngines);
  const base = {
    engineCode: code,
    label,
    asked: availability === 'asked',
    availability,
    fanout: fanoutOf(inputs.fanout, project, code),
  };
  if (availability !== 'asked') {
    return {
      ...base,
      ...NO_FIGURES,
      previous: null,
      change: { mentioned: NO_CHANGE, cited: NO_CHANGE, mentionedAndCited: NO_CHANGE, shareOfVoice: NO_CHANGE },
      citationShare: null,
      fanout: { exposed: base.fanout.exposed, presence: null },
    };
  }
  const figures = figuresOf(inputs.current.prompts, code);
  const before = inputs.previous === null ? null : figuresOf(inputs.previous.prompts, code);
  // A window with no answer of any kind is no data, not a rate of 0
  const previous = before === null || before.allAnswers === 0 ? null : before;
  return {
    ...base,
    ...figures,
    previous,
    change: {
      mentioned: changeOf(figures.mentioned, previous?.mentioned, true),
      cited: changeOf(figures.cited, previous?.cited, true),
      mentionedAndCited: changeOf(figures.mentionedAndCited, previous?.mentionedAndCited, true),
      shareOfVoice: changeOf(figures.shareOfVoice, previous?.shareOfVoice, false),
    },
    citationShare: citationShareOf(inputs.sources, code),
  };
}

/** The numbers and cards of the page from the reads of the scope; pure, and called once per change of the reads. */
export function buildAggregates(inputs: AggregateInputs): OverviewAggregates {
  const engines = ENGINES.map(({ code, label }) => engineAggregate(inputs, code, label));
  const { current } = inputs;
  return {
    promptCount: promptsInScope(current),
    topicCount: topicsInScope(current, inputs.topicsKept),
    engines,
    lastValidAt: newest(current.prompts.map((prompt) => prompt.last_valid_at)),
    lastObservedAt: newest(current.prompts.map((prompt) => prompt.last_observed_at)),
    // An engine whose previous window has no answer has no previous figures, which is 0 valid answers
    previousAnswers: inputs.previous === null ? null : sum(engines.map((entry) => entry.previous?.validAnswers ?? 0)),
  };
}
