import { hasEnoughAnswers, type PromptPairs } from './prompt-pairs';
import type { EngineAggregate, OverviewAggregates } from '../../data/aggregates';
import type { EngineCode } from '@/lib/api/types';

/**
 * The facts of "What changed" (CH-37, WP-34 plan section 3.3): counted statements about the window, as data. A fact
 * is a `kind`, its `params` (every number of its sentence, each with its denominator) and an optional `link`; the
 * words are the card's (`fact-sentences.tsx`), so no template lives here and no sentence is built from a string.
 *
 * The rules, in the order the facts are written:
 * 1. `collection`: for each asked engine with answers that were not valid, worst share first. It comes first because
 *    it changes how to read the rest.
 * 2. `engineChange`: one per engine whose mention change is detectable. If none is detectable and at least one
 *    engine's test found no change, one `withinVariation` counting those engines. Otherwise one `noPrevious` that
 *    says why (`noClaim` when a rate changed but the test makes no claim).
 * 3. `gainedLost`: per engine, prompts that named the brand before and not now, and the reverse, over prompts with 4
 *    or more valid answers on that engine in both windows; written only when either number is above 0. The prompts
 *    left out for fewer answers (a window with no cell of the engine is 0 answers) are counted in `leftOut`.
 * 4. `newSources`: only when the read answered, the total is above 0 and the previous window has answers.
 *
 * Not written, on purpose: the share of voice leader (share of voice has no interval, so no honest gap) and lost
 * sources (they need two windows after the support window). No causal word and no judgement of a change.
 */

/** Where the comparison with the previous window stands, from the card's reads. */
export type Comparison =
  /** The page's comparison is off, or its window cannot be asked. */
  | 'off'
  /** On, and the two reads are not of one scope yet: nothing is said about change meanwhile. */
  | 'pending'
  /** On, and the previous window could not be read. */
  | 'unread'
  /** On, and both windows were read. */
  | 'read';

/** `noClaim`: both windows have a rate, but the test makes no claim (the pooled and the prompt weighted change point apart). */
export type NoPreviousReason = 'off' | 'unread' | 'noAnswers' | 'tooFew' | 'noClaim';

/** Where a fact's number leads: the Prompts page, filtered to the engine. */
export interface FactLink {
  destination: 'prompts';
  engine: EngineCode;
}

interface FactBase {
  /** Stable across renders and scopes with the same facts; a React key. */
  id: string;
  link: FactLink | null;
}

export type Fact =
  | (FactBase & {
      kind: 'collection';
      params: { engine: EngineCode; notValid: number; all: number; days: number };
    })
  | (FactBase & {
      kind: 'engineChange';
      params: {
        engine: EngineCode;
        /** The mention rate now, 0 to 1, and the answers it counts: `k` of `n` valid answers over `prompts` prompts. */
        rate: number;
        k: number;
        n: number;
        prompts: number;
        /** The rate now minus the rate before, on the 0 to 1 scale. */
        delta: number;
        before: number;
        beforeK: number;
        beforeN: number;
      };
    })
  | (FactBase & { kind: 'withinVariation'; params: { engines: number } })
  | (FactBase & { kind: 'noPrevious'; params: { reason: NoPreviousReason; days: number } })
  | (FactBase & {
      kind: 'gainedLost';
      params: {
        engine: EngineCode;
        lost: number;
        /** Prompts that named the brand before: what `lost` is out of. */
        namedBefore: number;
        gained: number;
        /** Prompts that did not name the brand before: what `gained` is out of. */
        notNamedBefore: number;
        /** Prompts with 4 or more valid answers in both windows. */
        compared: number;
        /** Prompts in both windows with fewer than 4 valid answers in one of them. */
        leftOut: number;
      };
    })
  | (FactBase & { kind: 'newSources'; params: { count: number; minSupport: number; days: number } });

/** The read of the sources that first appeared: the rows `kind=new` lists (`page.total`) and the support asked of each. */
export interface NewSourcesCount {
  total: number;
  minSupport: number;
}

export interface FactsInput {
  aggregates: OverviewAggregates;
  comparison: Comparison;
  /** The prompts of both windows joined; `null` unless both were read. */
  pairs: PromptPairs | null;
  /** `null` when the read did not answer: no fact, no error. */
  newSources: NewSourcesCount | null;
  /** The days of the window, which the window before shares. */
  days: number;
}

/** A prompt names the brand when at least one of its valid answers does. */
const named = (mentioned: number): boolean => mentioned > 0;

function collectionFacts(asked: readonly EngineAggregate[], days: number): Fact[] {
  return (
    asked
      .filter((engine) => engine.allAnswers > engine.validAnswers)
      .map((engine) => ({ engine, notValid: engine.allAnswers - engine.validAnswers }))
      // The worst share first; the sort is stable, so equal shares keep the order of the catalog
      .sort((a, b) => b.notValid * a.engine.allAnswers - a.notValid * b.engine.allAnswers)
      .map(({ engine, notValid }): Fact => ({
        id: `collection:${engine.engineCode}`,
        kind: 'collection',
        params: { engine: engine.engineCode, notValid, all: engine.allAnswers, days },
        link: null,
      }))
  );
}

function engineChangeFact(engine: EngineAggregate): Fact | null {
  const { mentioned, change, previous } = engine;
  const before = previous?.mentioned;
  if (change.mentioned.detectable !== true || change.mentioned.delta === null) return null;
  if (mentioned.value === null || mentioned.successes === null) return null;
  if (before === undefined || before.value === null || before.successes === null) return null;
  return {
    id: `engineChange:${engine.engineCode}`,
    kind: 'engineChange',
    params: {
      engine: engine.engineCode,
      rate: mentioned.value,
      k: mentioned.successes,
      n: mentioned.answers,
      prompts: mentioned.prompts,
      delta: change.mentioned.delta,
      before: before.value,
      beforeK: before.successes,
      beforeN: before.answers,
    },
    link: { destination: 'prompts', engine: engine.engineCode },
  };
}

function changeFacts(
  asked: readonly EngineAggregate[],
  comparison: Comparison,
  previousAnswers: number,
  days: number,
): Fact[] {
  if (comparison === 'pending') return [];
  const noPrevious = (reason: NoPreviousReason): Fact[] => [
    { id: 'noPrevious', kind: 'noPrevious', params: { reason, days }, link: null },
  ];
  if (comparison !== 'read') return noPrevious(comparison);
  const changes = asked.flatMap((engine) => engineChangeFact(engine) ?? []);
  if (changes.length > 0) return changes;
  // Only a test that found no change says "within normal variation"; a change the test makes no claim about (null) does not
  const withinVariation = asked.filter((engine) => engine.change.mentioned.detectable === false).length;
  if (withinVariation > 0) {
    return [{ id: 'withinVariation', kind: 'withinVariation', params: { engines: withinVariation }, link: null }];
  }
  if (asked.some((engine) => engine.change.mentioned.delta !== null)) return noPrevious('noClaim');
  return noPrevious(previousAnswers === 0 ? 'noAnswers' : 'tooFew');
}

function gainedLostFacts(asked: readonly EngineAggregate[], pairs: PromptPairs): Fact[] {
  return asked.flatMap((engine): Fact[] => {
    const count = { lost: 0, namedBefore: 0, gained: 0, notNamedBefore: 0, compared: 0, leftOut: 0 };
    for (const prompt of pairs.prompts) {
      const pair = prompt.presence === 'both' ? prompt.engines[engine.engineCode] : undefined;
      if (pair === undefined) continue;
      // A missing cell is 0 valid answers: the prompt is left out, as the Table line says
      if (!hasEnoughAnswers(pair.now) || !hasEnoughAnswers(pair.before)) {
        count.leftOut += 1;
        continue;
      }
      count.compared += 1;
      const before = named(pair.before.mentioned);
      const now = named(pair.now.mentioned);
      if (before) count.namedBefore += 1;
      else count.notNamedBefore += 1;
      if (before && !now) count.lost += 1;
      if (!before && now) count.gained += 1;
    }
    if (count.lost === 0 && count.gained === 0) return [];
    return [
      {
        id: `gainedLost:${engine.engineCode}`,
        kind: 'gainedLost',
        params: { engine: engine.engineCode, ...count },
        link: null,
      },
    ];
  });
}

/** The facts of the window, all of them, in the fixed order of the rules; `limitFacts` cuts them to the card's option. */
export function buildFacts({ aggregates, comparison, pairs, newSources, days }: FactsInput): Fact[] {
  const asked = aggregates.engines.filter((engine) => engine.asked);
  const previousAnswers = aggregates.previousAnswers ?? 0;
  const read = comparison === 'read';
  const sources: Fact[] =
    read && newSources !== null && newSources.total > 0 && previousAnswers > 0
      ? [
          {
            id: 'newSources',
            kind: 'newSources',
            params: { count: newSources.total, minSupport: newSources.minSupport, days },
            link: null,
          },
        ]
      : [];
  return [
    ...collectionFacts(asked, days),
    ...changeFacts(asked, comparison, previousAnswers, days),
    ...(read && pairs !== null ? gainedLostFacts(asked, pairs) : []),
    ...sources,
  ];
}

/** The first `limit` facts, and how many more there are: those are listed in the Table view. */
export function limitFacts(facts: readonly Fact[], limit: number): { shown: Fact[]; hidden: number } {
  return { shown: facts.slice(0, limit), hidden: Math.max(0, facts.length - limit) };
}

/** The numbers of a fact as raw values, each with its denominator; `null` for what the fact does not have. */
export interface FactNumbers {
  count: number | null;
  of: number | null;
  /** The second pair of a fact that has two: the window before (`engineChange`), the gained prompts (`gainedLost`). */
  secondCount: number | null;
  secondOf: number | null;
  prompts: number | null;
  leftOut: number | null;
  /** The change in percentage points, signed, not rounded. */
  changePoints: number | null;
  days: number | null;
  minSupport: number | null;
}

const NO_NUMBERS: FactNumbers = {
  count: null,
  of: null,
  secondCount: null,
  secondOf: null,
  prompts: null,
  leftOut: null,
  changePoints: null,
  days: null,
  minSupport: null,
};

export function factNumbers(fact: Fact): FactNumbers {
  switch (fact.kind) {
    case 'collection':
      return { ...NO_NUMBERS, count: fact.params.notValid, of: fact.params.all, days: fact.params.days };
    case 'engineChange':
      return {
        ...NO_NUMBERS,
        count: fact.params.k,
        of: fact.params.n,
        secondCount: fact.params.beforeK,
        secondOf: fact.params.beforeN,
        prompts: fact.params.prompts,
        changePoints: fact.params.delta * 100,
      };
    case 'withinVariation':
      return { ...NO_NUMBERS, count: fact.params.engines };
    case 'noPrevious':
      return { ...NO_NUMBERS, days: fact.params.days };
    case 'gainedLost':
      return {
        ...NO_NUMBERS,
        count: fact.params.lost,
        of: fact.params.namedBefore,
        secondCount: fact.params.gained,
        secondOf: fact.params.notNamedBefore,
        prompts: fact.params.compared,
        leftOut: fact.params.leftOut,
      };
    case 'newSources':
      return { ...NO_NUMBERS, count: fact.params.count, days: fact.params.days, minSupport: fact.params.minSupport };
  }
}
