import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { engineCell as cellOf, type EngineInScope } from './engine-share';
import messages from '../../../messages/en.json';
import type { EngineTotals } from '@/lib/citations/share-model';
import type { EngineCode } from '@/lib/citations/types';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations.table' });
const CHATGPT = { code: 'chatgpt_web' as EngineCode, label: 'ChatGPT' };
const GEMINI = { code: 'gemini_web' as EngineCode, label: 'Gemini' };
const row = {
  engines: [
    { engine_code: 'chatgpt_web' as const, citation_units: 1912 },
    { engine_code: 'gemini_web' as const, citation_units: 0 },
  ],
};
const totals = (entries: [EngineCode, number][]): EngineTotals => new Map(entries);
const engineCell = (engine: EngineInScope, of: EngineTotals | null): ReturnType<typeof cellOf> =>
  cellOf(row, engine, of, t, 'en');

describe('engineCell', () => {
  it('is units over the engine total and n/a at a total of 0', () => {
    const known = engineCell(CHATGPT, totals([['chatgpt_web', 19120]]));
    expect(known).toMatchObject({ state: 'share', text: '10.0%' });
    // The engine had no citation at all in scope: not 0%
    const none = engineCell(GEMINI, totals([['gemini_web', 0]]));
    expect(none.state).toBe('none');
    expect(none.tip).toBe('Gemini has no citation in this window.');
  });

  it('says the units and the total in the tooltip', () => {
    const cell = engineCell(CHATGPT, totals([['chatgpt_web', 19120]]));
    expect(cell.tip).toBe('1,912 of 19,120 units on ChatGPT');
  });

  it('is a real 0% for an engine that has citations in scope and none for the row', () => {
    const cell = engineCell(GEMINI, totals([['gemini_web', 400]]));
    expect(cell).toMatchObject({ state: 'share', text: '0.0%' });
    expect(cell.tip).toBe('0 of 400 units on Gemini');
  });

  it('is n/a with its own reason when the totals are not known', () => {
    const cell = engineCell(CHATGPT, null);
    expect(cell.state).toBe('none');
    expect(cell.tip).toBe('The citations on ChatGPT are not known yet.');
  });

  it('is n/a for an engine the totals do not list', () => {
    const cell = engineCell(CHATGPT, totals([['gemini_web', 400]]));
    expect(cell).toMatchObject({ state: 'none', tip: 'ChatGPT has no citation in this window.' });
  });
});
