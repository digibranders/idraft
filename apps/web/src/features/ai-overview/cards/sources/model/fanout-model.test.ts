import { describe, expect, it } from 'vitest';

import { fanoutFigures, fanoutStanding } from './fanout-model';
import { fanoutMeta, fanoutPage, fanoutRow } from './fanout-fixtures';
import { at } from './source-fixtures';

describe('fanoutFigures', () => {
  it('takes the share of a query over meta.answers, never over the answers that issued any query', () => {
    const page = fanoutPage(
      [fanoutRow({ text: 'best crm for startups', observations: 14 })],
      fanoutMeta({ answers: 96, withFanout: 80 }),
    );
    const [row] = fanoutFigures(page);
    expect(row?.observations).toBe(14);
    expect(row?.answers).toBe(96);
    expect(row?.share).toBeCloseTo(14 / 96, 10);
    expect(row?.share).not.toBeCloseTo(14 / 80, 5);
  });

  it('has no share, and not 0, when no answer is counted', () => {
    const page = fanoutPage(
      [fanoutRow({ text: 'a query', observations: 3 })],
      fanoutMeta({ answers: 0, withFanout: 0 }),
    );
    expect(at(fanoutFigures(page), 0).share).toBeNull();
  });

  it('marks a query whose answers cited a domain of yours, and only then', () => {
    const page = fanoutPage([
      fanoutRow({
        text: 'with own',
        observations: 9,
        cited: [
          ['g2.com', 'third_party', 20],
          ['fynix.com', 'own', 4],
        ],
      }),
      fanoutRow({
        text: 'without own',
        observations: 8,
        cited: [
          ['g2.com', 'third_party', 20],
          ['hubspot.com', 'competitor', 4],
        ],
      }),
      fanoutRow({ text: 'cites nothing', observations: 7, cited: [] }),
    ]);
    expect(fanoutFigures(page).map((row) => row.ownCited)).toEqual([true, false, false]);
  });

  it('keeps the order of the route and the cited domains of each row as they came', () => {
    const page = fanoutPage([
      fanoutRow({ text: 'b second', observations: 4 }),
      fanoutRow({
        text: 'a first',
        observations: 9,
        cited: [
          ['x.com', 'third_party', 3],
          ['y.com', 'competitor', 2],
        ],
      }),
    ]);
    const rows = fanoutFigures(page);
    expect(rows.map((row) => row.text)).toEqual(['b second', 'a first']);
    expect(at(rows, 1).cited.map((domain) => domain.registrable_domain)).toEqual(['x.com', 'y.com']);
  });

  it('keeps one query on two engines as two rows with two ids', () => {
    const page = fanoutPage([
      fanoutRow({ text: 'same text', observations: 5, engine: 'chatgpt_web' }),
      fanoutRow({ text: 'same text', observations: 4, engine: 'gemini_web' }),
    ]);
    const ids = fanoutFigures(page).map((row) => row.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('passes the text through untouched: it is provider text and the card draws it as text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    expect(at(fanoutFigures(fanoutPage([fanoutRow({ text: hostile, observations: 2 })])), 0).text).toBe(hostile);
  });
});

describe('fanoutStanding', () => {
  it('is not exposed, and not zero, when the engines without fan-out are every engine in scope', () => {
    const page = fanoutPage(
      [],
      fanoutMeta({ answers: 0, withFanout: 0, engines: [], without: ['gemini_web', 'google_ai_mode'] }),
    );
    expect(fanoutStanding(page)).toEqual({ kind: 'not_exposed', without: ['gemini_web', 'google_ai_mode'] });
  });

  it('is not exposed whatever the counts say, when no engine in scope shows its queries', () => {
    const page = fanoutPage([], fanoutMeta({ answers: 40, withFanout: 0, engines: [], without: ['gemini_web'] }));
    expect(fanoutStanding(page).kind).toBe('not_exposed');
  });

  it('says there is no answer when the engines that show their queries have none in the window', () => {
    expect(fanoutStanding(fanoutPage([], fanoutMeta({ answers: 0, withFanout: 0 })))).toEqual({ kind: 'no_answers' });
  });

  it('says no answer issued a query when answers were counted and none did', () => {
    expect(fanoutStanding(fanoutPage([], fanoutMeta({ answers: 40, withFanout: 0 })))).toEqual({
      kind: 'none_issued',
      answers: 40,
    });
  });

  it('says no query reaches the minimum when answers issued queries and no row is listed', () => {
    expect(fanoutStanding(fanoutPage([], fanoutMeta({ answers: 40, withFanout: 12, minSupport: 3 })))).toEqual({
      kind: 'none_listed',
      min: 3,
    });
  });

  it('reads the counts and the engines without fan-out when queries are listed', () => {
    const page = fanoutPage(
      [fanoutRow({ text: 'q', observations: 5 })],
      fanoutMeta({ answers: 96, withFanout: 80, truncated: 6 }),
      12,
    );
    expect(fanoutStanding(page)).toEqual({
      kind: 'read',
      answers: 96,
      withFanout: 80,
      truncated: 6,
      without: ['gemini_web', 'google_ai_mode'],
      listed: 1,
      total: 12,
    });
  });
});
