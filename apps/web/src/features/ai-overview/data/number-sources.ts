import type { Change, CountRate, EngineAggregate, OverviewAggregates, RateCount } from './aggregates';
import type { NumberItem } from '@/lib/layouts/types';
import type { RateReason } from '@/lib/rates/strip-model';
import type { RateState } from '@/lib/stats';

/**
 * What each number of the AI visibility catalog (inventory 9.3, wave 1) reads from the aggregates, so that the
 * numbers zone maps a layout's `NumberItem` (`{ metric, engine? }`) to a value without arithmetic of its own: it
 * formats what is here. Pure, and the only place that knows which aggregate a catalog key means.
 */

/** The catalog keys with a source; `ai.recommendation_rate` waits for slice 2 and stays on the project Overview. */
export type NumberMetricKey =
  | 'ai.prompts_in_scope'
  | 'ai.valid_answers'
  | 'ai.mention_rate'
  | 'ai.citation_rate'
  | 'ai.mention_and_citation_rate'
  | 'ai.share_of_voice'
  | 'ai.citation_share'
  | 'ai.fanout_presence_rate';

/** What the denominator `n` counts: the context line names it ("of 1,800 answers", "of 18,420 citation units"). */
export type NumberUnit = 'answers' | 'namingAnswers' | 'citationUnits' | 'prompts';

/** A number that has been read: its value, the counts behind it, and what its context line and tip say. */
export interface NumberFigure {
  /** `ok` has a value; `insufficient` has only its counts (fewer valid answers than the minimum); `none` has nothing valid. */
  state: RateState;
  /** A rate on the 0 to 1 scale, or a count; `null` unless `state` is `ok`. Never 0 for what is unknown. */
  value: number | null;
  /** The numerator and denominator; `null` where the number has none (prompts) or the numerator is not a count (share of voice). */
  k: number | null;
  n: number | null;
  unit: NumberUnit;
  /** The prompts a prompt weighted rate averages over, each counted once. */
  prompts: number | null;
  /** The answers of the engine that were not valid. */
  invalid: number | null;
  /** The topics the prompts span (prompts in scope only). */
  topics: number | null;
  /** Why a rate is missing when `state` is `none`. */
  reason: RateReason | null;
  /**
   * The change since the previous window, `null` when there is nothing to compare with (never a change of 0). A
   * `points` delta is on the 0 to 1 scale; colour it only when `detectable` is `true`.
   */
  change: (Change & { unit: 'points' | 'count' }) | null;
  /** The mention rate's tooltip line "Cited 21%, SOV 27%": the rates of the same engine, `null` where unknown. */
  companions: { cited: number | null; shareOfVoice: number | null } | null;
}

export type NumberReading =
  /** The engine is off in the project, or left out of the engine filter. */
  | { status: 'notAsked'; why: 'off' | 'outsideFilter' }
  /** The engine does not show its fan-out. */
  | { status: 'notExposed' }
  /** The read behind the number is absent: still loading, failed, or it cannot answer the scope. */
  | { status: 'unread' }
  | { status: 'read'; figure: NumberFigure };

export type NumberSource =
  | { perEngine: false; read: (aggregates: OverviewAggregates) => NumberReading }
  | { perEngine: true; read: (aggregates: OverviewAggregates, engine: EngineAggregate) => NumberReading };

export type NumberValueSource = { readonly [Key in NumberMetricKey]: NumberSource };

const read = (figure: NumberFigure): NumberReading => ({ status: 'read', figure });

const EMPTY: Omit<NumberFigure, 'state' | 'value' | 'k' | 'n' | 'unit'> = {
  prompts: null,
  invalid: null,
  topics: null,
  reason: null,
  change: null,
  companions: null,
};

/** A change in points; none where there is no delta (a window without a rate or without an answer). */
const pointsOf = (change: Change): NumberFigure['change'] =>
  change.delta === null ? null : { ...change, unit: 'points' };

/** A rate of the prompt rows with its counts, the answers that were not valid, and its change. */
function rateFigure(engine: EngineAggregate, rate: RateCount, change: Change, unit: NumberUnit): NumberReading {
  return read({
    ...EMPTY,
    state: rate.state,
    value: rate.value,
    k: rate.successes,
    n: rate.answers,
    unit,
    prompts: rate.prompts,
    invalid: engine.allAnswers - engine.validAnswers,
    reason: rate.reason,
    change: pointsOf(change),
  });
}

/** A share of counts of another read (citation units, fan-out), which has no previous window here. */
function countFigure(rate: CountRate, unit: NumberUnit): NumberReading {
  return read({ ...EMPTY, state: rate.state, value: rate.value, k: rate.k, n: rate.n, unit });
}

/**
 * A source for one engine; an engine that is not asked is said so, before anything is read of it. `fromRows` is
 * for the numbers of the prompt rows: while the summary carried none they are unread, not "no answers".
 */
function perEngine(source: (engine: EngineAggregate) => NumberReading, fromRows: boolean = true): NumberSource {
  return {
    perEngine: true,
    read: (aggregates, engine) => {
      if (engine.availability !== 'asked') return { status: 'notAsked', why: engine.availability };
      return fromRows && !aggregates.rowsRead ? { status: 'unread' } : source(engine);
    },
  };
}

function validAnswers(engine: EngineAggregate): NumberReading {
  const { validAnswers: valid, allAnswers: all, previous } = engine;
  const none = valid === 0;
  return read({
    ...EMPTY,
    state: none ? 'none' : 'ok',
    value: none ? null : valid,
    k: valid,
    n: all,
    unit: 'answers',
    invalid: all - valid,
    reason: none ? (all === 0 ? 'noAnswers' : 'noneValid') : null,
    change: previous === null ? null : { delta: valid - previous.validAnswers, detectable: null, unit: 'count' },
  });
}

function mentionRate(engine: EngineAggregate): NumberReading {
  const reading = rateFigure(engine, engine.mentioned, engine.change.mentioned, 'answers');
  if (reading.status !== 'read') return reading;
  const companions = { cited: engine.cited.value, shareOfVoice: engine.shareOfVoice.value };
  return read({ ...reading.figure, companions });
}

function citationShare({ citationShare: share }: EngineAggregate): NumberReading {
  return share === null ? { status: 'unread' } : countFigure(share, 'citationUnits');
}

function fanoutPresence({ fanout }: EngineAggregate): NumberReading {
  if (!fanout.exposed) return { status: 'notExposed' };
  return fanout.presence === null ? { status: 'unread' } : countFigure(fanout.presence, 'answers');
}

export const NUMBER_VALUE_SOURCE: NumberValueSource = {
  'ai.prompts_in_scope': {
    perEngine: false,
    read: ({ promptCount, topicCount }) =>
      promptCount === null
        ? { status: 'unread' }
        : read({ ...EMPTY, state: 'ok', value: promptCount, k: null, n: null, unit: 'prompts', topics: topicCount }),
  },
  'ai.valid_answers': perEngine(validAnswers),
  'ai.mention_rate': perEngine(mentionRate),
  'ai.citation_rate': perEngine((engine) => rateFigure(engine, engine.cited, engine.change.cited, 'answers')),
  'ai.mention_and_citation_rate': perEngine((engine) =>
    rateFigure(engine, engine.mentionedAndCited, engine.change.mentionedAndCited, 'answers'),
  ),
  'ai.share_of_voice': perEngine((engine) =>
    rateFigure(engine, engine.shareOfVoice, engine.change.shareOfVoice, 'namingAnswers'),
  ),
  'ai.citation_share': perEngine(citationShare, false),
  'ai.fanout_presence_rate': perEngine(fanoutPresence, false),
};

const SOURCES: ReadonlyMap<string, NumberSource> = new Map(Object.entries(NUMBER_VALUE_SOURCE));

/**
 * The reading of a layout's number, or `null` when this page has no source for its metric or the number names no
 * engine of the catalog where it must (a layout is sanitized, so that is a stale or foreign item: the caller shows
 * it as not available, never as a value).
 */
export function readNumber(aggregates: OverviewAggregates, item: NumberItem): NumberReading | null {
  const source = SOURCES.get(item.metric);
  if (source === undefined) return null;
  if (!source.perEngine) return source.read(aggregates);
  const engine = aggregates.engines.find((entry) => entry.engineCode === item.engine);
  return engine === undefined ? null : source.read(aggregates, engine);
}
