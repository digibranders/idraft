import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type { NumberFigure, NumberReading } from '../data/number-sources';
import { numberDisplay, type NumberContext, type NumberDisplay, type Say } from './number-model';
import { formatMetricDelta } from '@/lib/format';
import type { NumberItem } from '@/lib/layouts/types';
import messages from '../../../../messages/en.json';

const translate = createTranslator({ locale: 'en', messages, namespace: 'aiOverview.numbers' });
// The catalog's keys are typed; the model takes the translator of any namespace by its plain keys
const say: Say = (key, values) => translate(key as never, values as never);

const CONTEXT: NumberContext = {
  window: { from: '2026-10-16', to: '2026-11-12' },
  days: 28,
  previous: { from: '2026-09-18', to: '2026-10-15' },
  previousEmpty: false,
  previousFailed: false,
  branded: 'excluded',
  busy: false,
  stale: false,
  unreadOf: () => 'loading',
};
const WINDOW_SENTENCE = 'Window: Oct 16 to Nov 12, 2026 (branded prompts excluded)';
const INTERIM = 'Unpaired test on pooled counts';

const chatgpt = (metric: string): NumberItem => ({ id: 'n', metric, engine: 'chatgpt_web' });
const gemini = (metric: string): NumberItem => ({ id: 'n', metric, engine: 'gemini_web' });

/** A figure written as counts: 612 of 1,800 valid answers over 250 prompts, 62 answers not valid. */
function figure(over: Partial<NumberFigure> = {}): NumberFigure {
  return {
    state: 'ok',
    value: 612 / 1800,
    k: 612,
    n: 1800,
    unit: 'answers',
    prompts: 250,
    invalid: 62,
    topics: null,
    reason: null,
    change: null,
    companions: null,
    ...over,
  };
}
const read = (over: Partial<NumberFigure> = {}): NumberReading => ({ status: 'read', figure: figure(over) });

const show = (reading: NumberReading | null, item: NumberItem, over: Partial<NumberContext> = {}): NumberDisplay =>
  numberDisplay(reading, item, { ...CONTEXT, ...over }, say);

/** The characters no string of this page may hold: the dashes, and a hyphen standing for one. */
const DASH = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]| - `);

describe('the numbers of the AI visibility catalog', () => {
  const rate = (over: Partial<NumberFigure>): NumberReading => read({ ...over });
  // One row per number of inventory 9.3 (wave 1): what it reads, what it shows, and what its context line says
  it.each([
    {
      name: 'ai.prompts_in_scope shows the count and "in 13 topics"',
      item: { id: 'n', metric: 'ai.prompts_in_scope' } satisfies NumberItem,
      reading: read({ value: 250, k: null, n: null, unit: 'prompts', prompts: null, invalid: null, topics: 13 }),
      value: '250',
      context: 'in 13 topics',
      tip: ['250 prompts in scope, each counted once across engines', WINDOW_SENTENCE],
    },
    {
      name: 'ai.valid_answers is an integer with its answers and the ones not valid',
      item: chatgpt('ai.valid_answers'),
      reading: read({ value: 1800, k: 1800, n: 1862, prompts: null, invalid: 62 }),
      value: '1,800',
      context: 'of 1,862 answers, 62 not valid',
      tip: ['1,800 of 1,862 answers were valid, 62 answers not valid', WINDOW_SENTENCE],
    },
    {
      name: 'ai.mention_rate shows the rate, "612 of 1,800 answers" and the counts in the tip',
      item: chatgpt('ai.mention_rate'),
      reading: rate({ companions: { cited: 0.21, shareOfVoice: 0.27 } }),
      value: '34%',
      context: '612 of 1,800 answers',
      tip: [
        '612 of 1,800 valid answers, 250 prompts each counted once, 62 answers not valid',
        'Cited 21%, share of voice 27%',
        WINDOW_SENTENCE,
      ],
    },
    {
      name: 'ai.citation_rate shows its own counts',
      item: chatgpt('ai.citation_rate'),
      reading: rate({ value: 378 / 1800, k: 378 }),
      value: '21%',
      context: '378 of 1,800 answers',
      tip: ['378 of 1,800 valid answers, 250 prompts each counted once, 62 answers not valid', WINDOW_SENTENCE],
    },
    {
      name: 'ai.mention_and_citation_rate shows the outcome counts',
      item: chatgpt('ai.mention_and_citation_rate'),
      reading: rate({ value: 301 / 1800, k: 301 }),
      value: '17%',
      context: '301 of 1,800 answers',
      tip: ['301 of 1,800 valid answers, 250 prompts each counted once, 62 answers not valid', WINDOW_SENTENCE],
    },
    {
      name: 'ai.share_of_voice says only "of N answers naming a tracked brand"',
      item: chatgpt('ai.share_of_voice'),
      reading: rate({ value: 0.27, k: null, n: 1412, unit: 'namingAnswers' }),
      value: '27%',
      context: 'of 1,412 answers naming a tracked brand',
      tip: [
        '1,412 valid answers name a tracked brand, 250 prompts each counted once, 62 answers not valid',
        WINDOW_SENTENCE,
      ],
    },
    {
      name: 'ai.citation_share reads own units over citation units with its counts',
      item: chatgpt('ai.citation_share'),
      reading: read({
        value: 1676 / 18420,
        k: 1676,
        n: 18420,
        unit: 'citationUnits',
        prompts: null,
        invalid: null,
      }),
      value: '9%',
      context: '1,676 of 18,420 citation units',
      tip: [
        '1,676 of 18,420 citation units come from your own pages',
        WINDOW_SENTENCE,
        'No comparison for this number',
      ],
    },
    {
      name: 'ai.fanout_presence_rate shows the answers that issued a fan-out query',
      item: chatgpt('ai.fanout_presence_rate'),
      reading: read({ value: 0.16, k: 96, n: 600, prompts: null, invalid: null }),
      value: '16%',
      context: '96 of 600 answers',
      tip: ['96 of 600 answers issued a fan-out query', WINDOW_SENTENCE, 'No comparison for this number'],
    },
  ])('$name', ({ item, reading, value, context, tip }) => {
    // The comparison is off here: what a change adds to a tip is tested below
    const display = show(reading, item, { previous: null });
    expect(display.value).toBe(value);
    expect(display.unknown).toBeNull();
    expect(display.context).toBe(context);
    expect(display.tip).toBe(`${tip.join('. ')}.`);
  });
});

describe('what a number says when it has no rate', () => {
  it('shows "3 answers" for a rate under 4 valid answers: hatched, no rate, no delta', () => {
    const display = show(
      read({ state: 'insufficient', value: null, k: 1, n: 3, prompts: 2, invalid: 0, change: null }),
      chatgpt('ai.mention_rate'),
    );
    expect(display.value).toBe('3 answers');
    expect(display.unknown).toEqual({ kind: 'insufficient' });
    expect(display.change).toBeNull();
    expect(display.context).toBe('Too few for a rate');
    expect(display.tip).toContain('3 valid answers, too few for a rate (it needs 4)');
  });

  it('counts the citation units of a share under the minimum in citation units', () => {
    const display = show(
      read({ state: 'insufficient', value: null, k: 1, n: 3, unit: 'citationUnits', prompts: null, invalid: null }),
      chatgpt('ai.citation_share'),
    );
    expect(display.value).toBe('3 citation units');
    expect(display.unknown).toEqual({ kind: 'insufficient' });
  });

  it('shows "No valid answers" with the answers that were not valid, never a zero', () => {
    const display = show(
      read({ state: 'none', value: null, k: null, n: 0, prompts: 0, invalid: 12, reason: 'noneValid' }),
      chatgpt('ai.mention_rate'),
    );
    expect(display.value).toBe('No valid answers');
    expect(display.unknown).toEqual({ kind: 'not-applicable' });
    expect(display.context).toBe('12 not valid');
    expect(display.value).not.toMatch(/^0/);
  });

  it('says there was no answer at all in the window when none was asked either', () => {
    const display = show(
      read({ state: 'none', value: null, k: null, n: 0, prompts: 0, invalid: 0, reason: 'noAnswers' }),
      chatgpt('ai.mention_rate'),
    );
    expect(display.value).toBe('No valid answers');
    expect(display.context).toBe('No answers at all');
  });

  it('says no brand is named for a share of voice that has answers and no brand', () => {
    const display = show(
      read({ state: 'none', value: null, k: null, n: 0, unit: 'namingAnswers', invalid: 3, reason: 'noBrandNamed' }),
      chatgpt('ai.share_of_voice'),
    );
    expect(display.value).toBe('No brand named');
  });

  it('shows n/a for a count of another read that has nothing, not zero', () => {
    const display = show(
      read({ state: 'none', value: null, k: 0, n: 0, unit: 'citationUnits', prompts: null, invalid: null }),
      chatgpt('ai.citation_share'),
    );
    expect(display.value).toBe('n/a');
    expect(display.context).toBe('No citation units');
  });

  it('shows loading, not "No valid answers", while the reads of a changed scope are under way', () => {
    const display = show(
      read({ state: 'none', value: null, k: null, n: 0, prompts: 0, invalid: 0, reason: 'noAnswers' }),
      chatgpt('ai.mention_rate'),
      { busy: true },
    );
    expect(display.value).toBe('Reading');
    expect(display.unknown).toEqual({ kind: 'pending' });
  });

  it('says an engine outside the engine filter is Not asked, with the reason', () => {
    const display = show({ status: 'notAsked', why: 'outsideFilter' }, gemini('ai.mention_rate'));
    expect(display.value).toBe('Not asked');
    expect(display.unknown).toEqual({ kind: 'not-applicable' });
    expect(display.context).toBe('Not in the engine filter');
    expect(display.tip).toContain('Gemini is not in the engine filter');
    expect(display.change).toBeNull();
  });

  it('says an engine that is off is Off in this project', () => {
    const display = show({ status: 'notAsked', why: 'off' }, gemini('ai.mention_rate'));
    expect(display.value).toBe('Not asked');
    expect(display.context).toBe('Off in this project');
    expect(display.tip).toContain('Gemini is off in this project');
  });

  it('says fan-out presence on an engine that does not show it is Not exposed', () => {
    const display = show({ status: 'notExposed' }, gemini('ai.fanout_presence_rate'));
    expect(display.value).toBe('Not exposed');
    expect(display.unknown).toEqual({ kind: 'not-applicable' });
    expect(display.tip).toContain('Gemini does not show the searches it ran');
  });

  it('says why a read is absent: loading, failed, or not available for the choice', () => {
    const unread: NumberReading = { status: 'unread' };
    const loading = show(unread, chatgpt('ai.citation_share'), { unreadOf: () => 'loading' });
    expect(loading.value).toBe('Reading');
    expect(loading.unknown).toEqual({ kind: 'pending' });
    expect(loading.tip).toBeUndefined();
    const failed = show(unread, chatgpt('ai.citation_share'), { unreadOf: () => 'error' });
    expect(failed.value).toBe('n/a');
    expect(failed.context).toBe('Could not be read');
    expect(failed.tip).toContain('could not be read');
    const branded = show(unread, chatgpt('ai.citation_share'), { unreadOf: () => 'brandedOnly' });
    expect(branded.value).toBe('n/a');
    expect(branded.context).toBe('Not available for branded prompts only');
  });

  it('shows n/a for a number this page has no source for', () => {
    const display = show(null, chatgpt('ai.recommendation_rate'));
    expect(display.value).toBe('n/a');
    expect(display.unknown).toEqual({ kind: 'not-applicable' });
    expect(display.change).toBeNull();
  });
});

describe('the change since the previous window', () => {
  const withChange = (delta: number, detectable: boolean | null): NumberReading =>
    read({ change: { delta, detectable, unit: 'points' } });

  it('colours a change only when it is detectable', () => {
    const display = show(withChange(0.061, true), chatgpt('ai.mention_rate'));
    expect(display.change).toEqual({ value: 0.061, unit: 'points', polarity: 'higher_is_better', isDetectable: true });
    expect(display.change === null ? null : formatMetricDelta(display.change).tone).toBe('positive');
    expect(display.tip).toContain('Change against Sep 18 to Oct 15, 2026: +6.1 pts');
    expect(display.tip).toContain('Larger than normal variation');
    expect(display.tip).toContain(INTERIM);
  });

  it('says within normal variation, in neutral, when the change is not detectable', () => {
    const display = show(withChange(0.021, false), chatgpt('ai.mention_rate'));
    expect(display.change === null ? null : formatMetricDelta(display.change).tone).toBe('neutral');
    expect(display.tip).toContain('Within normal variation');
    expect(display.tip).toContain(INTERIM);
  });

  it('makes no claim, in neutral, when there is no test for the change', () => {
    const display = show(withChange(0.011, null), chatgpt('ai.share_of_voice'));
    expect(display.change).toEqual({ value: 0.011, unit: 'points', polarity: 'higher_is_better', isDetectable: null });
    expect(display.change === null ? null : formatMetricDelta(display.change).tone).toBe('neutral');
    expect(display.tip).toContain('No claim is made about whether this change is real');
    expect(display.tip).not.toContain('Within normal variation');
    expect(display.tip).not.toContain(INTERIM);
  });

  it('shows the change of the valid answers as a count, never coloured', () => {
    const display = show(
      read({ value: 1800, k: 1800, n: 1862, prompts: null, change: { delta: -140, detectable: null, unit: 'count' } }),
      chatgpt('ai.valid_answers'),
    );
    expect(display.change).toEqual({ value: -140, unit: 'count', polarity: 'neutral', isDetectable: null });
    expect(display.change === null ? null : formatMetricDelta(display.change).tone).toBe('neutral');
  });

  it('leaves the delta out, and says why, when the previous window has no answer', () => {
    const display = show(read({ change: null }), chatgpt('ai.mention_rate'), { previousEmpty: true });
    expect(display.change).toBeNull();
    expect(display.tip).toContain('No answers in the previous 28 days');
  });

  it('leaves the delta out and says so when a window has too few answers for a rate', () => {
    const display = show(read({ change: null }), chatgpt('ai.mention_rate'));
    expect(display.change).toBeNull();
    expect(display.tip).toContain('No change shown: a window has too few valid answers for a rate');
  });

  it('says nothing about a change while the comparison is off', () => {
    const display = show(read({ change: null }), chatgpt('ai.mention_rate'), { previous: null });
    expect(display.change).toBeNull();
    expect(display.tip).not.toMatch(/change|comparison|previous/i);
  });

  it('says the previous window could not be read, and shows no delta', () => {
    const display = show(read({ change: null }), chatgpt('ai.mention_rate'), { previousFailed: true });
    expect(display.change).toBeNull();
    expect(display.tip).toContain('The previous window could not be read');
  });

  it('has no comparison for the citation share and the fan-out presence, and says so', () => {
    for (const metric of ['ai.citation_share', 'ai.fanout_presence_rate']) {
      const display = show(read({ unit: 'citationUnits', prompts: null }), chatgpt(metric));
      expect(display.change).toBeNull();
      expect(display.tip).toContain('No comparison for this number');
    }
  });

  it('says the figures are the last read when a later read failed', () => {
    const display = show(read(), chatgpt('ai.mention_rate'), { stale: true });
    expect(display.tip).toContain('The last read failed. These are the last figures read');
  });
});

describe('every string of every number', () => {
  const ITEMS = [
    chatgpt('ai.mention_rate'),
    chatgpt('ai.share_of_voice'),
    chatgpt('ai.citation_share'),
    { id: 'n', metric: 'ai.prompts_in_scope' } satisfies NumberItem,
  ];
  const READINGS: NumberReading[] = [
    read({
      change: { delta: -0.008, detectable: false, unit: 'points' },
      companions: { cited: null, shareOfVoice: null },
    }),
    read({ state: 'insufficient', value: null, n: 3 }),
    read({ state: 'none', value: null, k: null, n: 0, invalid: 5, reason: 'noneValid' }),
    { status: 'notAsked', why: 'off' },
    { status: 'notAsked', why: 'outsideFilter' },
    { status: 'notExposed' },
    { status: 'unread' },
  ];

  it('names the window, the prompt count and the answers that were not valid in the tip of a rate', () => {
    const tip = show(read(), chatgpt('ai.mention_rate')).tip ?? '';
    expect(tip).toContain('Oct 16 to Nov 12');
    expect(tip).toContain('250 prompts');
    expect(tip).toContain('62 answers not valid');
  });

  it('holds no dash in a value, a context line or a tip', () => {
    for (const item of ITEMS) {
      for (const reading of READINGS) {
        for (const unreadOf of ['loading', 'error', 'idle', 'brandedOnly'] as const) {
          const display = show(reading, item, { unreadOf: () => unreadOf, previousEmpty: true, stale: true });
          for (const text of [display.value, display.context ?? '', display.tip ?? '']) expect(text).not.toMatch(DASH);
        }
      }
    }
  });
});
