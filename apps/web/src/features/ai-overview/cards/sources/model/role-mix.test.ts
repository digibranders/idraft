import { describe, expect, it } from 'vitest';

import { metaWithSplit } from './page-fixtures';
import { roleMix, ROLES } from './role-mix';
import { at, sourcesMeta } from './source-fixtures';
import { roleUnits } from '@/lib/citations/share-model';

const CHATGPT = { engine: 'chatgpt_web', own: [300, 120], competitor: [600, 200], thirdParty: [1100, 300] } as const;
const GEMINI = { engine: 'gemini_web', own: [112, 60], competitor: [188, 70], thirdParty: [400, 90] } as const;

describe('roleMix', () => {
  it('has one entry per engine of the read, in the order of the catalog whatever order the read had', () => {
    const meta = metaWithSplit([GEMINI, CHATGPT]);
    expect(roleMix(meta).map((mix) => mix.engineCode)).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('gives the shares of the three roles of one engine, which add up to 1', () => {
    const mix = at(roleMix(metaWithSplit([CHATGPT])), 0);
    if (mix.state !== 'ok') throw new Error('expected an ok engine');
    expect(mix.total).toBe(2000);
    expect(mix.shares.map((entry) => [entry.role, entry.units])).toEqual([
      ['own', 300],
      ['competitor', 600],
      ['third_party', 1100],
    ]);
    expect(mix.shares.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 10);
    expect(at(mix.shares, 0).share).toBeCloseTo(0.15, 10);
  });

  it('never pools: each engine has its own total and its own shares', () => {
    const [chatgpt, gemini] = roleMix(metaWithSplit([CHATGPT, GEMINI]));
    expect(chatgpt).toMatchObject({ state: 'ok', total: 2000 });
    expect(gemini).toMatchObject({ state: 'ok', total: 700 });
  });

  it('says none, and gives no share, for an engine with no citation unit', () => {
    const empty = { engine: 'gemini_web', own: [0, 0], competitor: [0, 0], thirdParty: [0, 0] } as const;
    const [chatgpt, gemini] = roleMix(metaWithSplit([CHATGPT, empty]));
    expect(chatgpt?.state).toBe('ok');
    expect(gemini).toEqual({ engineCode: 'gemini_web', state: 'none' });
  });

  it('says none for an engine the read asked and a present split does not list', () => {
    const [, gemini] = roleMix({ ...metaWithSplit([CHATGPT]), engine_codes: ['chatgpt_web', 'gemini_web'] });
    expect(gemini).toEqual({ engineCode: 'gemini_web', state: 'none' });
  });

  it('says the split is unavailable, never none, for a read that carries no split at all', () => {
    const asked = sourcesMeta({ engines: ['chatgpt_web', 'gemini_web'], units: 900 });
    expect(roleMix(asked)).toEqual([
      { engineCode: 'chatgpt_web', state: 'unavailable' },
      { engineCode: 'gemini_web', state: 'unavailable' },
    ]);
    expect(roleMix({ ...asked, by_role_by_engine: null }).map((mix) => mix.state)).toEqual([
      'unavailable',
      'unavailable',
    ]);
  });

  it('is thin when fewer than 4 answers can stand behind the engine, with its units and no shares', () => {
    const thin = { engine: 'gemini_web', own: [3, 1], competitor: [2, 1], thirdParty: [1, 1] } as const;
    expect(at(roleMix(metaWithSplit([thin])), 0)).toEqual({
      engineCode: 'gemini_web',
      state: 'thin',
      answers: 3,
      total: 6,
    });
  });

  it('is not thin once the answers can reach 4, though the roles overlap', () => {
    const enough = { engine: 'gemini_web', own: [3, 2], competitor: [2, 1], thirdParty: [1, 1] } as const;
    expect(at(roleMix(metaWithSplit([enough])), 0).state).toBe('ok');
  });

  it('adds up, over the engines, to the units of each role of the scope (parity with by_role)', () => {
    const meta = metaWithSplit([CHATGPT, GEMINI]);
    const summed = { own: 0, competitor: 0, third_party: 0 };
    for (const mix of roleMix(meta)) {
      if (mix.state !== 'ok') continue;
      for (const entry of mix.shares) summed[entry.role] += entry.units;
    }
    expect(summed).toEqual(roleUnits(meta));
  });

  it('keeps the roles in one fixed order, own first', () => {
    expect(ROLES).toEqual(['own', 'competitor', 'third_party']);
  });
});
