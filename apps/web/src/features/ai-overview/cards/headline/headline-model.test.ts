import { describe, expect, it } from 'vitest';

import { engineCells, promptRow, summaryOf, week } from '../engines/engines.test-fixtures';
import {
  buildHero,
  FLOOR_OF,
  readAcross,
  readFactTile,
  readTile,
  runsInWindow,
  sparkOf,
  type Platforms,
  type Reading,
} from './headline-model';
import type { EngineCode, EngineSummary, PromptSummaryRow, Run } from '@/lib/api/types';
import type { WeekWithVisibility } from '@/lib/api/week-visibility';
import { cellOf as factCell, engine, rowOf } from '@/lib/prompt-facts/test-helpers';
import type { PositionCounts, SentimentCounts } from '@/lib/prompt-facts';
import { visibilityOfPrompts } from '@/lib/rates/visibility-model';

type Parts = readonly [both: number, named: number, cited: number, neither: number];

/** An engine's cells of one prompt written as the counts of its four outcomes; the other cells follow from them. */
function cells(code: EngineCode, [both, named, cited, neither]: Parts): EngineSummary {
  const n = both + named + cited + neither;
  return engineCells(code, {
    mentioned: [both + named, n],
    cited: [both + cited, n],
    shareOfVoice: [both + named, n],
    outcomes: { mentionedAndCited: [both, n], mentionedOnly: [named, n], citedOnly: [cited, n], neither: [neither, n] },
  });
}

const prompt = (id: string, code: EngineCode, parts: Parts): PromptSummaryRow => promptRow(id, [cells(code, parts)]);

const ONE: Platforms = { asked: ['chatgpt_web'], single: 'chatgpt_web' };
const ALL: Platforms = { asked: ['chatgpt_web', 'gemini_web'], single: null };

const ok = (reading: Reading): Extract<Reading, { state: 'ok' }> => {
  if (reading.state !== 'ok') throw new Error(`expected a figure, got ${reading.state}`);
  return reading;
};

describe('the hero', () => {
  it('is the Prompts strip visibility (the same function), and equals 100% minus neither', () => {
    const prompts = [prompt('p1', 'chatgpt_web', [10, 5, 5, 20]), prompt('p2', 'chatgpt_web', [0, 2, 1, 2])];
    const hero = buildHero(prompts, ONE, 2);
    const strip = visibilityOfPrompts(prompts, 'chatgpt_web');
    expect(ok(hero.reading).value).toBe(strip.value);
    expect(hero.split?.shares.neither).toBeCloseTo(1 - ok(hero.reading).value, 12);
    // visible and neither add up to every valid answer, the four outcomes to one
    const shares = Object.values(hero.split?.shares ?? {});
    expect(shares.reduce((total, share) => total + share, 0)).toBeCloseTo(1, 12);
  });

  it('one platform carries its counts, each prompt counting once', () => {
    const prompts = [prompt('p1', 'chatgpt_web', [10, 5, 5, 20]), prompt('p2', 'chatgpt_web', [0, 2, 1, 2])];
    const hero = buildHero(prompts, ONE, 2);
    expect(ok(hero.reading).basis).toMatchObject({ kind: 'counts', n: 45, k: 23, prompts: 2 });
    expect(hero.prompts).toBe(2);
    expect(hero.split?.counts).toEqual({ mentioned_and_cited: 10, mentioned_only: 7, cited_only: 6, neither: 22 });
    expect(hero.split?.answers).toBe(45);
  });

  it('All platforms is the equal-weight average of the platforms with a rate, never pooled, and names them', () => {
    const prompts = [
      promptRow('p1', [cells('chatgpt_web', [30, 0, 0, 10]), cells('gemini_web', [0, 0, 0, 5])]),
      // AI Mode is asked but has too few answers: it takes no part
      promptRow('p2', [cells('chatgpt_web', [0, 0, 0, 0]), cells('google_ai_mode', [1, 0, 0, 1])]),
    ];
    const all: Platforms = { asked: ['chatgpt_web', 'gemini_web', 'google_ai_mode'], single: null };
    const hero = buildHero(prompts, all, 2);
    const reading = ok(hero.reading);
    // ChatGPT 75%, Gemini 0%: the average is 37.5%, where the pooled ratio would be 30 of 45
    expect(reading.value).toBeCloseTo(0.375, 12);
    expect(reading.value).not.toBeCloseTo(30 / 45, 3);
    expect(reading.basis).toEqual({ kind: 'average', codes: ['chatgpt_web', 'gemini_web'] });
    expect(hero.prompts).toBe(2);
    expect(hero.split?.counts).toBeNull();
    expect(hero.split?.shares.mentioned_and_cited).toBeCloseTo((0.75 + 0) / 2, 12);
  });

  it('has no rate under 4 valid answers: the count that fell short, never a 0', () => {
    const hero = buildHero([prompt('p1', 'chatgpt_web', [1, 1, 0, 0])], ONE, 1);
    expect(hero.reading).toEqual({ state: 'insufficient', n: 2, noun: 'answers' });
    expect(hero.split).toBeNull();
    const none = buildHero([prompt('p1', 'chatgpt_web', [0, 0, 0, 0])], ONE, 1);
    expect(none.reading).toEqual({ state: 'none' });
  });

  it('All platforms with every platform under the floor is insufficient with the largest count', () => {
    const prompts = [promptRow('p1', [cells('chatgpt_web', [1, 0, 0, 1]), cells('gemini_web', [1, 1, 0, 0])])];
    const hero = buildHero(prompts, ALL, 1);
    expect(hero.reading).toEqual({ state: 'insufficient', n: 2, noun: 'answers' });
  });
});

describe('the tiles', () => {
  it('mention, share of voice and citation come from the strip rates of the platform', () => {
    const prompts = [prompt('p1', 'chatgpt_web', [10, 5, 5, 20])];
    expect(ok(readTile({ prompts }, ONE, 'mention')).value).toBeCloseTo(15 / 40, 12);
    expect(ok(readTile({ prompts }, ONE, 'citation')).value).toBeCloseTo(15 / 40, 12);
    const sov = ok(readTile({ prompts }, ONE, 'sov'));
    // Share of voice counts brand mentions: its numerator is the own brand's mentions
    expect(sov.basis).toMatchObject({ kind: 'counts', noun: 'brandMentions' });
  });

  it('share of voice says not collected, or cut by the cap, and never a percent without its counts', () => {
    const prompts = [prompt('p1', 'chatgpt_web', [10, 5, 5, 20])];
    const noted = (note: 'notCollected' | 'capped'): PromptSummaryRow[] =>
      prompts.map((row) => ({
        ...row,
        engines: row.engines.map((entry) => ({
          ...entry,
          share_of_voice: { ...entry.share_of_voice, share_note: note },
        })),
      }));
    expect(readTile({ prompts: noted('notCollected') }, ONE, 'sov')).toEqual({ state: 'notCollected' });
    expect(readTile({ prompts: noted('capped') }, ONE, 'sov')).toEqual({ state: 'capped' });
    // Every platform of All platforms lacks the counts for the same reason
    const both = [promptRow('p1', [cells('chatgpt_web', [10, 5, 5, 20]), cells('gemini_web', [4, 6, 2, 8])])].map(
      (row) => ({
        ...row,
        engines: row.engines.map((entry) => ({
          ...entry,
          share_of_voice: { ...entry.share_of_voice, share_note: 'notCollected' as const },
        })),
      }),
    );
    expect(readTile({ prompts: both }, ALL, 'sov')).toEqual({ state: 'notCollected' });
    // The other tiles do not follow it
    expect(readTile({ prompts: noted('notCollected') }, ONE, 'mention').state).toBe('ok');
  });

  it('All platforms says each platform own x of y brand mentions, with no pooled count', () => {
    const prompts = [promptRow('p1', [cells('chatgpt_web', [10, 5, 5, 20]), cells('gemini_web', [4, 6, 2, 8])])];
    const read = ok(readTile({ prompts }, ALL, 'sov'));
    expect(read.basis).toMatchObject({
      kind: 'average',
      parts: [
        { code: 'chatgpt_web', k: 15, n: 40 },
        { code: 'gemini_web', k: 10, n: 20 },
      ],
    });
  });

  it('a platform with fewer than 4 answers has no value, and says how many it has', () => {
    const prompts = [prompt('p1', 'chatgpt_web', [1, 0, 1, 0])];
    expect(readTile({ prompts }, ONE, 'mention')).toEqual({ state: 'insufficient', n: 2, noun: 'answers' });
  });
});

describe('readAcross', () => {
  it('no platform asked is none, not a zero', () => {
    expect(readAcross([], false, 'answers')).toEqual({ state: 'none' });
  });
});

describe('the weekly points of a tile', () => {
  const series = (values: readonly (readonly [string, number, number])[]): ReturnType<typeof week>[] =>
    values.map(([start, k, n]) => week(start, { mentioned: [k, n], prompts: 1 }));

  it('is the last eight weeks of the platform, a week under the floor a gap', () => {
    const weeks = Array.from({ length: 10 }, (_, index): readonly [string, number, number] => [
      `2026-09-${String(7 + index * 7).padStart(2, '0')}`.replace('2026-09-35', '2026-10-05'),
      index + 1,
      10,
    ]);
    const first = engineCells('chatgpt_web', { mentioned: [5, 10], series: series(weeks) });
    const summary = summaryOf([promptRow('p1', [first])]);
    const points = sparkOf(summary, ONE, 'mention');
    expect(points).toHaveLength(8);
  });

  it('the hero line is the weekly visibility, and is not drawn while the API sends none', () => {
    const withVisibility = (start: string, k: number, n: number): WeekWithVisibility => ({
      ...week(start, { mentioned: [0, n], prompts: 1 }),
      visibility: factCell(k, n),
    });
    const weeks = [
      withVisibility('2026-10-19', 2, 10),
      withVisibility('2026-10-26', 4, 10),
      withVisibility('2026-11-02', 6, 10),
    ];
    const summary = summaryOf([promptRow('p1', [engineCells('chatgpt_web', { mentioned: [5, 10], series: weeks })])]);
    expect(sparkOf(summary, ONE, 'visibility')).toEqual([0.2, 0.4, 0.6]);
    // The same weeks without the visibility cell: nothing is made up from the mention cells
    const plain = summaryOf([
      promptRow('p1', [
        engineCells('chatgpt_web', {
          mentioned: [5, 10],
          series: series([
            ['2026-10-19', 2, 10],
            ['2026-10-26', 4, 10],
          ]),
        }),
      ]),
    ]);
    expect(sparkOf(plain, ONE, 'visibility')).toBeNull();
  });

  it('is not drawn from fewer than two points', () => {
    const only = engineCells('chatgpt_web', { mentioned: [5, 10], series: series([['2026-10-05', 5, 10]]) });
    expect(sparkOf(summaryOf([promptRow('p1', [only])]), ONE, 'mention')).toBeNull();
  });
});

describe('the runs behind the numbers', () => {
  const run = (status: Run['status'], createdAt: string, completedAt: string | null = null): Run =>
    ({ status, created_at: createdAt, completed_at: completedAt }) as Run;
  const window = { from: '2026-10-16', to: '2026-11-12' };

  it('counts the collecting runs that began inside the window, in the project zone, and names the newest', () => {
    const found = runsInWindow(
      [
        run('completed', '2026-11-09T02:00:00Z', '2026-11-09T02:10:00Z'),
        run('completed_with_errors', '2026-10-20T02:00:00Z', '2026-10-20T02:30:00Z'),
        // Not collecting, or outside the window
        run('failed', '2026-11-02T02:00:00Z'),
        run('planned', '2026-11-12T02:00:00Z'),
        run('completed', '2026-10-01T02:00:00Z', '2026-10-01T02:10:00Z'),
        // The window ends on Nov 12 in UTC: a run at 23:30 UTC on Nov 12 is Nov 13 in Kolkata
        run('completed', '2026-11-12T23:30:00Z', '2026-11-12T23:40:00Z'),
      ],
      window,
      'UTC',
    );
    expect(found).toEqual({ count: 3, last: '2026-11-12T23:40:00Z' });
    expect(runsInWindow([run('completed', '2026-11-12T23:30:00Z')], window, 'Asia/Kolkata').count).toBe(0);
  });

  it('no run is a count of 0 with no last time', () => {
    expect(runsInWindow([], window, 'UTC')).toEqual({ count: 0, last: null });
  });
});

describe('the tiles read from the facts', () => {
  /** The counts of answers by place, the ones the Mention position card reads (`by_order`), and the sum of the places. */
  const place = (rankSum: number, counts: readonly [number, number, number, number]): PositionCounts => {
    const ordered = counts.reduce((total, count) => total + count, 0);
    return {
      rank_sum: rankSum,
      ordered_answers: ordered,
      mentions: ordered,
      answers: 10,
      by_order: { counts, rank_sum: rankSum },
    };
  };
  const tone = (positive: number, neutral: number, negative: number, mixed: number): SentimentCounts => ({
    positive,
    neutral,
    negative,
    mixed,
  });

  it('are the figures their cards show: one platform with its counts, All platforms the platform average', () => {
    const rows = [
      rowOf(
        engine('chatgpt_web', {
          position: place(9, [1, 4, 0, 0]),
          sentiment: tone(6, 2, 1, 1),
          recommended: factCell(4, 10),
        }),
        engine('gemini_web', {
          position: place(20, [0, 0, 0, 5]),
          sentiment: tone(2, 6, 1, 1),
          recommended: factCell(2, 10),
        }),
      ),
    ];
    const one = ok(readFactTile(rows, ONE, 'position'));
    expect(one.value).toBeCloseTo(1.8);
    expect(one.basis).toMatchObject({ kind: 'counts', n: 5, noun: 'orderedAnswers' });
    // Equal weight: (1.8 + 4) / 2, not the pooled 29 / 10
    const all = ok(readFactTile(rows, ALL, 'position'));
    expect(all.value).toBeCloseTo(2.9);
    expect(all.basis).toEqual({ kind: 'average', codes: ['chatgpt_web', 'gemini_web'] });
    expect(ok(readFactTile(rows, ONE, 'sentiment')).value).toBeCloseTo(0.6);
    expect(ok(readFactTile(rows, ALL, 'sentiment')).value).toBeCloseTo(0.4);
    expect(ok(readFactTile(rows, ALL, 'recommendation')).value).toBeCloseTo(0.3);
  });

  it('read the mean position from the position counts alone, as the API sends them (no counts by place)', () => {
    const counts = (rank_sum: number, ordered_answers: number): PositionCounts => ({
      rank_sum,
      ordered_answers,
      mentions: ordered_answers,
      answers: 10,
    });
    const rows = [
      rowOf(engine('chatgpt_web', { position: counts(6, 3) }), engine('gemini_web', { position: counts(1, 1) })),
      rowOf(engine('chatgpt_web', { position: counts(3, 2) }), engine('gemini_web', { position: counts(0, 0) })),
    ];
    // ChatGPT: (6 + 3) / (3 + 2) = 1.8 over 5 ordered answers
    const one = ok(readFactTile(rows, ONE, 'position'));
    expect(one.value).toBeCloseTo(1.8);
    expect(one.basis).toMatchObject({ kind: 'counts', n: 5, noun: 'orderedAnswers' });
    // Gemini has 1 ordered answer, under the floor of 2: it takes no part, so All platforms is ChatGPT's mean
    const all = ok(readFactTile(rows, ALL, 'position'));
    expect(all.value).toBeCloseTo(1.8);
    expect(all.basis).toEqual({ kind: 'average', codes: ['chatgpt_web'] });
  });

  it('say too few, with the floor of 2, when one ordered answer is all there is', () => {
    const one = [
      rowOf(engine('chatgpt_web', { position: { rank_sum: 1, ordered_answers: 1, mentions: 1, answers: 10 } })),
    ];
    expect(readFactTile(one, ONE, 'position')).toEqual({ state: 'insufficient', n: 1, noun: 'orderedAnswers' });
    expect(FLOOR_OF.orderedAnswers).toBe(2);
  });

  it('say not collected when the rows carry no facts, never a zero', () => {
    const rows = [rowOf(engine('chatgpt_web'))];
    for (const tile of ['position', 'recommendation', 'sentiment'] as const) {
      expect(readFactTile(rows, ONE, tile)).toEqual({ state: 'notCollected' });
    }
  });

  it('say too few when a floor is not met, and not classified when the platform does not classify', () => {
    const few = [rowOf(engine('chatgpt_web', { position: place(1, [1, 0, 0, 0]), sentiment: tone(1, 1, 0, 0) }))];
    expect(readFactTile(few, ONE, 'position')).toEqual({ state: 'insufficient', n: 1, noun: 'orderedAnswers' });
    expect(readFactTile(few, ONE, 'sentiment')).toEqual({ state: 'insufficient', n: 2, noun: 'judgedMentions' });
    const unclassified = [rowOf(engine('gemini_web', { sentiment: null, recommended: null }))];
    expect(readFactTile(unclassified, { asked: ['gemini_web'], single: 'gemini_web' }, 'sentiment')).toEqual({
      state: 'notClassified',
    });
  });
});
