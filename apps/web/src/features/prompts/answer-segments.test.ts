import { describe, expect, it } from 'vitest';

import { answerSegments, clipSegments } from './answer-segments';
import type { MentionOut } from '@/lib/api/types';

/** Text built from code points, so this file stays ASCII. */
const cp = (...points: number[]): string => String.fromCodePoint(...points);
/** One character past U+FFFF: two UTF-16 units, which a viewer that counts characters gets wrong. */
const MAGNIFIER = cp(0x1f50e);
/** "bharat mein " in Devanagari: nine units, each letter and sign one. */
const HINDI_BEFORE = cp(0x92d, 0x93e, 0x930, 0x924, 0x20, 0x92e, 0x947, 0x902, 0x20);
/** " ek SEO agency hai." in Devanagari, with the Latin SEO in the middle. */
const HINDI_AFTER = cp(
  ...[0x20, 0x90f, 0x915, 0x20, 0x53, 0x45, 0x4f, 0x20, 0x90f, 0x91c, 0x947, 0x902, 0x938, 0x940, 0x20],
  ...[0x939, 0x948, 0x964],
);

const mention = (name: string, spans: [number, number][], order: number | null = 1): MentionOut => ({
  entity_id: `id-${name}`,
  name,
  role: name === 'Fynix' ? 'own' : 'competitor',
  mention_count: spans.length,
  first_char_offset: spans[0]?.[0] ?? 0,
  mention_order: order,
  match_method: 'alias_word',
  mention_status: 'accepted',
  confidence: 0.95,
  evidence_spans: spans,
});

const shape = (text: string, mentions: MentionOut[]): [string, number, string][] =>
  answerSegments(text, mentions).map((segment) => [segment.kind, segment.start, segment.text]);

describe('answerSegments', () => {
  it('cuts an English answer at its mentions, in order', () => {
    const text = 'Fynix and Rankforge are named.';
    expect(shape(text, [mention('Rankforge', [[10, 19]]), mention('Fynix', [[0, 5]])])).toEqual([
      ['mention', 0, 'Fynix'],
      ['text', 5, ' and '],
      ['mention', 10, 'Rankforge'],
      ['text', 19, ' are named.'],
    ]);
  });

  it('keeps a mention that names the entity more than once at each of its spans', () => {
    const text = 'Fynix, then Fynix again';
    expect(
      shape(text, [
        mention('Fynix', [
          [0, 5],
          [12, 17],
        ]),
      ]),
    ).toEqual([
      ['mention', 0, 'Fynix'],
      ['text', 5, ', then '],
      ['mention', 12, 'Fynix'],
      ['text', 17, ' again'],
    ]);
  });

  it('reads the spans as UTF-16 units, so an emoji before a name counts two', () => {
    // The emoji is one character and two units: "Fynix" starts at unit 3, not at character 2
    const text = `${MAGNIFIER} Fynix leads.`;
    expect(shape(text, [mention('Fynix', [[3, 8]])])).toEqual([
      ['text', 0, `${MAGNIFIER} `],
      ['mention', 3, 'Fynix'],
      ['text', 8, ' leads.'],
    ]);
  });

  it('marks a name inside Hindi text, whose letters and signs are one unit each', () => {
    const text = `${HINDI_BEFORE}Fynix${HINDI_AFTER}`;
    expect(HINDI_BEFORE).toHaveLength(9);
    expect(shape(text, [mention('Fynix', [[9, 14]])])).toEqual([
      ['text', 0, HINDI_BEFORE],
      ['mention', 9, 'Fynix'],
      ['text', 14, HINDI_AFTER],
    ]);
  });

  it('leaves out a span that starts inside a character, as code point offsets read as units would', () => {
    // Units 0 and 1 are the first emoji: a span from unit 1 starts inside it
    const text = `${MAGNIFIER}${MAGNIFIER} Fynix`;
    expect(shape(text, [mention('Fynix', [[1, 6]])])).toEqual([['text', 0, text]]);
  });

  it('leaves out a span that ends inside a character', () => {
    const text = `Fynix${MAGNIFIER} leads`;
    expect(shape(text, [mention('Fynix', [[0, 6]])])).toEqual([['text', 0, text]]);
  });

  it('keeps a span that ends right after a character past U+FFFF', () => {
    const text = `Fynix${MAGNIFIER} leads`;
    expect(shape(text, [mention('Fynix', [[0, 7]])])).toEqual([
      ['mention', 0, `Fynix${MAGNIFIER}`],
      ['text', 7, ' leads'],
    ]);
  });

  it('leaves out a span outside the text, an empty one and one that overlaps an earlier one', () => {
    const text = 'Fynix and Rankforge.';
    expect(
      shape(text, [
        mention('Fynix', [
          [0, 5],
          [3, 9],
        ]),
        mention('Rankforge', [
          [10, 40],
          [12, 12],
        ]),
      ]),
    ).toEqual([
      ['mention', 0, 'Fynix'],
      ['text', 5, ' and Rankforge.'],
    ]);
  });

  it('never trusts a span that is negative, backwards, fractional or not a number', () => {
    const text = 'Fynix and Rankforge.';
    expect(
      shape(text, [
        mention('Fynix', [
          [-3, 5],
          [5, 0],
          [0.5, 4],
          [Number.NaN, 4],
          [0, Number.POSITIVE_INFINITY],
        ]),
      ]),
    ).toEqual([['text', 0, text]]);
  });

  it('survives spans that are not pairs of numbers', () => {
    const text = 'Fynix leads.';
    const broken = { ...mention('Fynix', []), evidence_spans: [null, [1], 'ab', [0, 5]] } as unknown as MentionOut;
    expect(shape(text, [broken])).toEqual([
      ['mention', 0, 'Fynix'],
      ['text', 5, ' leads.'],
    ]);
    const missing = { ...mention('Fynix', []), evidence_spans: undefined } as unknown as MentionOut;
    expect(shape(text, [missing])).toEqual([['text', 0, text]]);
  });

  it('lets the earlier start win where mentions overlap, whatever the order of the mentions', () => {
    const text = 'Brightwave Digital leads.';
    const wide = mention('Brightwave Digital', [[0, 18]]);
    const inside = mention('Digital', [[11, 18]]);
    const expected = [
      ['mention', 0, 'Brightwave Digital'],
      ['text', 18, ' leads.'],
    ];
    expect(shape(text, [wide, inside])).toEqual(expected);
    expect(shape(text, [inside, wide])).toEqual(expected);
  });

  it('lets the longer span win from the same start, and the first mention win for identical spans', () => {
    const text = 'Fynix Audit covers it.';
    const brand = mention('Fynix', [[0, 11]], 1);
    const product = mention('Fynix Audit', [[0, 11]], null);
    const short = mention('Fynix short', [[0, 5]], 2);
    const winner = (mentions: MentionOut[]): string[] =>
      answerSegments(text, mentions).flatMap((segment) => (segment.kind === 'mention' ? [segment.mention.name] : []));
    expect(winner([short, brand])).toEqual(['Fynix']);
    expect(winner([brand, product])).toEqual(['Fynix']);
    expect(winner([product, brand])).toEqual(['Fynix Audit']);
  });

  it('puts the spans of different mentions in the order of the text, not of the list', () => {
    const text = 'A Fynix B Rankforge C';
    const segments = shape(text, [mention('Rankforge', [[10, 19]]), mention('Fynix', [[2, 7]])]);
    expect(segments.map(([, start]) => start)).toEqual([0, 2, 7, 10, 19]);
    expect(segments.map(([, , piece]) => piece).join('')).toBe(text);
  });

  it('gives the whole text back, and cuts nothing, for an answer with no mentions or no text', () => {
    expect(shape('Nothing is named.', [])).toEqual([['text', 0, 'Nothing is named.']]);
    expect(shape('', [mention('Fynix', [[0, 5]])])).toEqual([]);
    expect(shape('', [])).toEqual([]);
  });

  it('always gives back the text it was given, whatever the spans', () => {
    const text = `${MAGNIFIER} Fynix${MAGNIFIER}${HINDI_BEFORE}Rankforge`;
    const spans: [number, number][] = [
      [0, 1],
      [1, 3],
      [3, 8],
      [8, 9],
      [9, 10],
      [10, 15],
      [2, 40],
      [-1, 3],
      [7, 7],
    ];
    const joined = answerSegments(
      text,
      spans.map((span, place) => mention(`E${String(place)}`, [span])),
    )
      .map((segment) => segment.text)
      .join('');
    expect(joined).toBe(text);
  });
});

describe('clipSegments', () => {
  const text = 'Fynix is named here, and Rankforge follows later in the answer.';
  const segments = answerSegments(text, [mention('Fynix', [[0, 5]]), mention('Rankforge', [[25, 34]])]);

  it('keeps every segment of a text that fits, and says nothing was cut', () => {
    expect(clipSegments(segments, text.length)).toEqual({ segments, clipped: false });
  });

  it('cuts the text at the limit, marking what is left of a mention it cuts through', () => {
    const clip = clipSegments(segments, 29);
    expect(clip.clipped).toBe(true);
    expect(clip.segments.map((segment) => [segment.kind, segment.text])).toEqual([
      ['mention', 'Fynix'],
      ['text', ' is named here, and '],
      ['mention', 'Rank'],
    ]);
  });

  it('drops the segments that start past the limit', () => {
    const clip = clipSegments(segments, 10);
    expect(clip.segments.map((segment) => segment.text).join('')).toBe('Fynix is n');
  });

  it('never cuts a character past U+FFFF in two', () => {
    const emoji = `ab${MAGNIFIER}cd`;
    const clip = clipSegments(answerSegments(emoji, []), 3);
    expect(clip.segments.map((segment) => segment.text).join('')).toBe('ab');
    expect(
      clipSegments(answerSegments(emoji, []), 4)
        .segments.map((segment) => segment.text)
        .join(''),
    ).toBe(`ab${MAGNIFIER}`);
  });

  it('never cuts a letter from its accent, a joined emoji or a flag', () => {
    const cases = [
      [`ab${cp(0x65, 0x301)}cd`, 3, 'ab'],
      [`ab${cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)}cd`, 6, 'ab'],
      [`ab${cp(0x1f1ee, 0x1f1f3)}cd`, 4, 'ab'],
    ] as const;
    for (const [text, max, kept] of cases) {
      const clip = clipSegments(answerSegments(text, []), max);
      expect(clip.segments.map((segment) => segment.text).join('')).toBe(kept);
      expect(clip.clipped).toBe(true);
    }
  });

  it('gives nothing back for a text with no segments', () => {
    expect(clipSegments([], 280)).toEqual({ segments: [], clipped: false });
  });
});
