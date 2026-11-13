import type { NumberFigure, NumberReading } from '../data/number-sources';
import type { Branded } from '../scope/scope-model';
import type { MetricStripItem } from '@/components/app/metric/metric-strip';
import {
  EMPTY_VALUE,
  formatDateRange,
  formatInteger,
  formatMetricDelta,
  formatPercent,
  formatPointsDelta,
  type MetricDeltaInput,
} from '@/lib/format';
import { engineLabel } from '@/lib/layouts';
import type { NumberItem } from '@/lib/layouts/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * What the strip of the AI visibility Overview says of each number (WP-33 plan sections 3.4 and 3.5), as plain
 * data: the value text, the unknown state, the change, the context line and the tip. The arithmetic is not here
 * (`number-sources.ts` reads it from the aggregates); this is only how a reading is put into words.
 *
 * The rules, each with a test: every figure carries its counts and its denominator; a rate under the minimum of
 * valid answers shows the answers and no rate; unknown is never zero (no answer, not asked, not exposed, not
 * read); a change is coloured only when it is detectable and is never drawn without a comparison; the tip names
 * the window, the prompts and the answers that were not valid.
 */

/** The words of the `aiOverview.numbers` namespace. */
export type Say = (key: string, values?: Record<string, string | number>) => string;

/**
 * Why a number has nothing to show for a read it needs: it is under way (`loading`), it failed (`error`), it does
 * not run for this scope (`idle`), it cannot be asked for branded prompts alone (`brandedOnly`), no engine of the
 * choice is on so nothing is asked (`noEngine`), or it is read for one engine at a time and more than one is on
 * (`oneAtATime`, the fan-out presence).
 */
export type UnreadWhy = 'loading' | 'error' | 'idle' | 'brandedOnly' | 'noEngine' | 'oneAtATime';

interface DateWindow {
  from: string;
  to: string;
}

/** What every number of the page shares: the scope's words and the state of the reads behind it. */
export interface NumberContext {
  window: DateWindow;
  /** The days of the window, for "No answers in the previous 28 days". */
  days: number;
  /**
   * The window the change is against, once its read has settled; `null` with the comparison off and while that read
   * is still under way, when there is nothing to say of a change yet.
   */
  previous: DateWindow | null;
  /** The previous window was read and has no answer at all. */
  previousEmpty: boolean;
  /** The previous window could not be read. */
  previousFailed: boolean;
  branded: Branded;
  /**
   * The figures held may be of the scope before the one now chosen (a read is loading, or shows the last scope's
   * data while the new one is read): an empty figure is not yet known, and the window is not claimed for them.
   */
  busy: boolean;
  /** A later read failed and the figures are the last that were read. */
  stale: boolean;
  /** Why a number has no reading, by its metric. */
  unreadOf: (metric: string) => UnreadWhy;
}

/** What `MetricStrip` draws of a number, with the change left as the input of its `Delta`. */
export interface NumberDisplay {
  value: string;
  unknown: NonNullable<MetricStripItem['unknown']> | null;
  /** The change since the previous window; `null` draws no delta, never a zero. */
  change: MetricDeltaInput | null;
  context: string | null;
  /** The counts, the window and what the change rests on; `undefined` when there is nothing to add. */
  tip: string | undefined;
}

/** The numbers whose value is a count, not a rate. */
const COUNTS: ReadonlySet<string> = new Set(['ai.prompts_in_scope', 'ai.valid_answers']);
/** The numbers whose reads carry no previous window, so they have no change to draw. */
const NO_COMPARISON: ReadonlySet<string> = new Set(['ai.citation_share', 'ai.fanout_presence_rate']);

const NOT_APPLICABLE = { kind: 'not-applicable' } as const;
const PENDING = { kind: 'pending' } as const;
const INSUFFICIENT = { kind: 'insufficient' } as const;

/** The sentences of a tip, joined as the design system's tooltips are, ending in a full stop. */
const tipOf = (parts: readonly (string | null)[]): string =>
  `${parts.filter((part): part is string => part !== null).join('. ')}.`;

/** The same rates the Topics and Prompts strip shows: whole percents, with the counts beside them. */
const percent = (ratio: number | null): string => formatPercent(ratio, { decimals: 0 });

const shown = (value: string, rest: Partial<Omit<NumberDisplay, 'value'>> = {}): NumberDisplay => ({
  value,
  unknown: null,
  change: null,
  context: null,
  tip: undefined,
  ...rest,
});

/** "branded prompts excluded": the part of the scope that is not in the window, and changes what is counted. */
export function brandedWords(say: Say, branded: Branded): string {
  return say(branded === 'only' ? 'brandedOnly' : branded === 'included' ? 'brandedIncluded' : 'brandedExcluded');
}

/** The name of the strip: the window and the branded choice, so the scope is never ambiguous. */
export function stripLabel(say: Say, window: DateWindow, branded: Branded): string {
  return say('label', { window: formatDateRange(window.from, window.to), branded: brandedWords(say, branded) });
}

/** The window the counts are of; not said while they may be those of the scope before, which this window is not. */
const windowSentence = (ctx: NumberContext, say: Say): string | null =>
  ctx.busy
    ? null
    : say('tipWindow', {
        window: formatDateRange(ctx.window.from, ctx.window.to),
        branded: brandedWords(say, ctx.branded),
      });

const staleSentence = (ctx: NumberContext, say: Say): string | null => (ctx.stale ? say('tipStale') : null);

function notAsked(item: NumberItem, why: 'off' | 'outsideFilter', say: Say): NumberDisplay {
  const engine = item.engine === undefined ? '' : engineLabel(item.engine);
  return shown(say('notAsked'), {
    unknown: NOT_APPLICABLE,
    context: say(why === 'off' ? 'engineOff' : 'outsideFilter'),
    tip: tipOf([say(why === 'off' ? 'tipOff' : 'tipOutside', { engine })]),
  });
}

function notExposed(item: NumberItem, say: Say): NumberDisplay {
  const engine = item.engine === undefined ? '' : engineLabel(item.engine);
  return shown(say('notExposed'), {
    unknown: NOT_APPLICABLE,
    tip: tipOf([say('tipNotExposed', { engine })]),
  });
}

const loading = (say: Say): NumberDisplay => shown(say('loading'), { unknown: PENDING });

function unread(item: NumberItem, ctx: NumberContext, say: Say): NumberDisplay {
  switch (ctx.unreadOf(item.metric)) {
    case 'loading':
      return loading(say);
    case 'error':
      return shown(EMPTY_VALUE, {
        unknown: NOT_APPLICABLE,
        context: say('couldNotRead'),
        tip: tipOf([say('tipUnread')]),
      });
    case 'brandedOnly':
      return shown(EMPTY_VALUE, {
        unknown: NOT_APPLICABLE,
        context: say('brandedOnlyUnavailable'),
        tip: tipOf([say('tipBrandedOnly')]),
      });
    case 'oneAtATime':
      return shown(EMPTY_VALUE, {
        unknown: NOT_APPLICABLE,
        context: say('oneAtATime'),
        tip: tipOf([say('tipOneAtATime')]),
      });
    case 'noEngine':
      return shown(say('notAsked'), {
        unknown: NOT_APPLICABLE,
        context: say('noEngine'),
        tip: tipOf([say('tipNoEngine')]),
      });
    case 'idle':
      return shown(EMPTY_VALUE, {
        unknown: NOT_APPLICABLE,
        context: say('notAvailable'),
        tip: tipOf([say('tipIdle')]),
      });
  }
}

/** The counts behind a figure that has a value: the numerator, the denominator, the prompts, the invalid answers. */
function countsSentence(item: NumberItem, figure: NumberFigure, say: Say): string | null {
  const { k, n, prompts, invalid } = figure;
  const counts = { count: k ?? 0, total: n ?? 0, prompts: prompts ?? 0, invalid: invalid ?? 0 };
  if (figure.unit === 'prompts') return say('tipPrompts', { count: figure.value ?? 0 });
  if (figure.unit === 'citationUnits') return say('tipUnits', counts);
  if (figure.unit === 'namingAnswers') return say('tipNaming', counts);
  if (item.metric === 'ai.valid_answers') return say('tipValid', counts);
  return prompts === null ? say('tipFanout', counts) : say('tipAnswers', counts);
}

/** The line under the value: what it is a share or a count of. */
function contextOf(item: NumberItem, figure: NumberFigure, say: Say): string | null {
  const { k, n, invalid, topics } = figure;
  const total = n ?? 0;
  switch (figure.unit) {
    case 'prompts':
      return topics === null ? null : say('inTopics', { count: topics });
    case 'namingAnswers':
      return say('ofNaming', { total });
    case 'citationUnits':
      return say('ofUnits', { count: k ?? 0, total });
    case 'answers':
      if (item.metric === 'ai.valid_answers') {
        return (invalid ?? 0) > 0
          ? say('ofAllAnswersInvalid', { total, invalid: invalid ?? 0 })
          : say('ofAllAnswers', { total });
      }
      return k === null ? null : say('ofAnswers', { count: k, total });
  }
}

/** What the change rests on, and the delta to draw, for a figure that has a value. */
function changeOf(
  item: NumberItem,
  figure: NumberFigure,
  ctx: NumberContext,
  say: Say,
): { input: MetricDeltaInput | null; sentences: string[] } {
  if (NO_COMPARISON.has(item.metric)) return { input: null, sentences: [say('tipNoCompare')] };
  const { previous } = ctx;
  // The prompts in scope are the same prompts in both windows: there is no change to draw or to explain
  if (previous === null || figure.unit === 'prompts') return { input: null, sentences: [] };
  const { change } = figure;
  if (change === null) {
    if (ctx.previousFailed) return { input: null, sentences: [say('tipPreviousFailed')] };
    if (ctx.previousEmpty) return { input: null, sentences: [say('tipNoPrevious', { days: ctx.days })] };
    return { input: null, sentences: [say('tipNoChange')] };
  }
  // A change that rounds to "0 pts" is none at the precision shown: the shared formatter takes the direction from the
  // raw value ("down 0 pts") and the test was of a change that is not drawn, so neither is claimed
  if (change.unit === 'points' && formatPointsDelta(change.delta) === '0 pts') {
    const flat: MetricDeltaInput = { value: 0, unit: 'points', polarity: 'higher_is_better', isDetectable: null };
    return {
      input: flat,
      sentences: [
        say('tipChange', {
          previous: formatDateRange(previous.from, previous.to),
          change: formatMetricDelta(flat).text,
        }),
        say('tipNoChangeHere'),
      ],
    };
  }
  const input: MetricDeltaInput = {
    value: change.delta,
    unit: change.unit,
    // A count of answers is information, not a verdict; a rate going up is good
    polarity: change.unit === 'count' ? 'neutral' : 'higher_is_better',
    isDetectable: change.detectable,
  };
  const sentences = [
    say('tipChange', {
      previous: formatDateRange(previous.from, previous.to),
      change: formatMetricDelta(input).text,
    }),
  ];
  if (change.unit === 'points') {
    sentences.push(
      change.detectable === true
        ? say('tipDetectable')
        : change.detectable === false
          ? say('tipWithin')
          : say('tipNoClaim'),
    );
    // The label is for a change that was tested: the interim test is the one that was run
    if (change.detectable !== null) sentences.push(say('interim'));
  }
  return { input, sentences };
}

function okDisplay(item: NumberItem, figure: NumberFigure, ctx: NumberContext, say: Say): NumberDisplay {
  const { input, sentences } = changeOf(item, figure, ctx, say);
  // A line of two unknowns says nothing: it is left out unless one of the rates is known
  const companions =
    figure.companions === null || (figure.companions.cited === null && figure.companions.shareOfVoice === null)
      ? null
      : say('tipCompanions', {
          cited: percent(figure.companions.cited),
          shareOfVoice: percent(figure.companions.shareOfVoice),
        });
  return shown(COUNTS.has(item.metric) ? formatInteger(figure.value) : percent(figure.value), {
    change: input,
    context: contextOf(item, figure, say),
    tip: tipOf([
      countsSentence(item, figure, say),
      companions,
      windowSentence(ctx, say),
      ...sentences,
      staleSentence(ctx, say),
    ]),
  });
}

function insufficientDisplay(figure: NumberFigure, ctx: NumberContext, say: Say): NumberDisplay {
  const count = figure.n ?? 0;
  const units = figure.unit === 'citationUnits';
  const answers = { count, min: MIN_OBSERVATIONS, invalid: figure.invalid ?? 0 };
  // A share of voice counts the answers that name a tracked brand, not every valid answer
  const few = units
    ? say('tipFewUnits', { count, min: MIN_OBSERVATIONS })
    : say(figure.unit === 'namingAnswers' ? 'tipFewNaming' : 'tipFew', answers);
  return shown(say(units ? 'fewUnits' : 'fewAnswers', { count }), {
    unknown: INSUFFICIENT,
    context: say('tooFew'),
    tip: tipOf([few, windowSentence(ctx, say), staleSentence(ctx, say)]),
  });
}

function noneDisplay(figure: NumberFigure, ctx: NumberContext, say: Say): NumberDisplay {
  const { invalid, reason } = figure;
  // A share of another read (citation units, fan-out) has no answers of its own to call not valid
  if (invalid === null) {
    const context = say(figure.unit === 'citationUnits' ? 'noUnits' : 'noAnswersYet');
    return shown(EMPTY_VALUE, {
      unknown: NOT_APPLICABLE,
      context,
      tip: tipOf([context, windowSentence(ctx, say), staleSentence(ctx, say)]),
    });
  }
  return shown(say(reason === 'noBrandNamed' ? 'noBrand' : 'noValid'), {
    unknown: NOT_APPLICABLE,
    context: invalid > 0 ? say('invalid', { count: invalid }) : reason === 'noAnswers' ? say('noAnswersYet') : null,
    tip: tipOf([say('tipNone', { invalid }), windowSentence(ctx, say), staleSentence(ctx, say)]),
  });
}

function readDisplay(item: NumberItem, figure: NumberFigure, ctx: NumberContext, say: Say): NumberDisplay {
  switch (figure.state) {
    case 'ok':
      return okDisplay(item, figure, ctx, say);
    case 'insufficient':
      return insufficientDisplay(figure, ctx, say);
    case 'none':
      // While a read is under way the data may be of the scope before this one: an empty figure is not yet known
      return ctx.busy ? loading(say) : noneDisplay(figure, ctx, say);
  }
}

/**
 * One number of the strip in words. `reading` is `readNumber`'s answer: `null` for a metric this page has no
 * source for. Pure: the same reading and context give the same display.
 */
export function numberDisplay(
  reading: NumberReading | null,
  item: NumberItem,
  ctx: NumberContext,
  say: Say,
): NumberDisplay {
  if (reading === null) {
    return shown(EMPTY_VALUE, {
      unknown: NOT_APPLICABLE,
      context: say('notAvailable'),
      tip: tipOf([say('tipNotAvailable')]),
    });
  }
  switch (reading.status) {
    case 'notAsked':
      return notAsked(item, reading.why, say);
    case 'notExposed':
      return notExposed(item, say);
    case 'unread':
      return unread(item, ctx, say);
    case 'read':
      return readDisplay(item, reading.figure, ctx, say);
  }
}
