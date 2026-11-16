import { describe, expect, it } from 'vitest';

import { LEAD_MARGIN, leadsOf } from './lead-rule';
import { at, cell, competitor, engine, entityCells, own, promptRow, share, summaryOf } from './summary-fixtures';
import { trackedSetOf } from './tracked-set';

const HUBSPOT = competitor(2, 'HubSpot');
const ENTITIES = [own(), HUBSPOT];

/** One prompt on one platform: `n` valid answers, you named in `you`, HubSpot in `rival`. */
function onPlatform(code: string, n: number, you: number, rival: number) {
  return engine(code, {
    mentioned: cell(you, n),
    entities: [entityCells(own(), cell(you, n), share(you, n)), entityCells(HUBSPOT, cell(rival, n), share(rival, n))],
  });
}

function leadOf(rows: ReturnType<typeof promptRow>[], codes: string[]) {
  const summary = summaryOf({ entities: ENTITIES, prompts: rows });
  const read = leadsOf(summary, codes, trackedSetOf(summary, null));
  if (read.status !== 'read') throw new Error('unread');
  return at(read.competitors, 0);
}

describe('leadsOf', () => {
  it('uses a margin of 2 answers', () => {
    expect(LEAD_MARGIN).toBe(2);
  });

  it.each([
    [1, 'close'],
    [2, 'they'],
    [3, 'they'],
    [-1, 'close'],
    [-2, 'you'],
    [0, 'close'],
  ] as const)('a difference of %i named answers is %s on one platform', (diff, expected) => {
    const rival = diff > 0 ? 5 + diff : 5;
    const you = diff < 0 ? 5 - diff : 5;
    const lead = leadOf([promptRow(1, [onPlatform('chatgpt_web', 12, you, rival)])], ['chatgpt_web']);
    expect(at(lead.prompts, 0).lead).toBe(expected);
    expect(lead.compared).toBe(1);
  });

  it('leaves out a prompt with fewer than 4 valid answers and counts it as too few', () => {
    const summary = summaryOf({
      entities: ENTITIES,
      prompts: [promptRow(1, [onPlatform('chatgpt_web', 3, 0, 3)]), promptRow(2, [onPlatform('chatgpt_web', 8, 0, 4)])],
    });
    const read = leadsOf(summary, ['chatgpt_web'], trackedSetOf(summary, null));
    if (read.status !== 'read') throw new Error('unread');
    expect(read.tooFew).toBe(1);
    expect(at(read.competitors, 0).compared).toBe(1);
    expect(at(read.competitors, 0).they).toBe(1);
  });

  it('counts a prompt once for All platforms: they lead on one platform and you on none is they', () => {
    const lead = leadOf(
      [promptRow(1, [onPlatform('chatgpt_web', 8, 1, 5), onPlatform('gemini_web', 8, 4, 4)])],
      ['chatgpt_web', 'gemini_web'],
    );
    expect(lead).toMatchObject({ they: 1, you: 0, close: 0, compared: 1 });
  });

  it('is close when they lead on one platform and you lead on another', () => {
    const lead = leadOf(
      [promptRow(1, [onPlatform('chatgpt_web', 8, 1, 5), onPlatform('gemini_web', 8, 6, 2)])],
      ['chatgpt_web', 'gemini_web'],
    );
    expect(lead).toMatchObject({ they: 0, you: 0, close: 1, compared: 1 });
  });

  it('never adds the answers of platforms together: 3 answers on each of two platforms is not comparable', () => {
    const lead = leadOf(
      [promptRow(1, [onPlatform('chatgpt_web', 3, 0, 3), onPlatform('gemini_web', 3, 0, 3)])],
      ['chatgpt_web', 'gemini_web'],
    );
    expect(lead.compared).toBe(0);
  });

  it('ignores a platform outside the scope', () => {
    const lead = leadOf(
      [promptRow(1, [onPlatform('chatgpt_web', 8, 1, 5), onPlatform('gemini_web', 8, 6, 2)])],
      ['chatgpt_web'],
    );
    expect(lead).toMatchObject({ they: 1, you: 0, compared: 1 });
  });

  it('gives with one platform the same count as that platform alone among several', () => {
    const rows = [
      promptRow(1, [onPlatform('chatgpt_web', 8, 1, 5)]),
      promptRow(2, [onPlatform('chatgpt_web', 8, 5, 1)]),
      promptRow(3, [onPlatform('chatgpt_web', 8, 3, 4)]),
    ];
    expect(leadOf(rows, ['chatgpt_web'])).toMatchObject({ they: 1, you: 1, close: 1, compared: 3 });
  });

  it('is unread when no prompt row lists the platforms with entity cells', () => {
    const summary = summaryOf({ entities: ENTITIES, prompts: [promptRow(1, [engine('chatgpt_web')])] });
    expect(leadsOf(summary, ['chatgpt_web'], trackedSetOf(summary, null)).status).toBe('unread');
  });
});
