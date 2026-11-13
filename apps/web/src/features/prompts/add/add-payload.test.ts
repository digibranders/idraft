import { describe, expect, it } from 'vitest';

import { classifyLines, type ClassifiedLine } from './add-model';
import { buildCreateBody, buildItems, restoreIds, type PayloadValues } from './add-payload';
import { promptKeyOf, readPromptLines } from '../prompt-model';
import type { Schemas } from '@/lib/api/types';

const TERM = '00000000-0000-4000-8000-0000000000a1';
const OTHER_TERM = '00000000-0000-4000-8000-0000000000a2';
const ARCHIVED = '00000000-0000-4000-8000-0000000000b1';

const values = (extra: Partial<PayloadValues> = {}): PayloadValues => ({
  languageCode: 'en',
  countryIso: 'DE',
  termIds: [],
  promptType: null,
  intent: 'unknown',
  funnelStage: 'unknown',
  importance: 3,
  branded: null,
  ...extra,
});
const lines = (...texts: string[]): { text: string }[] => texts.map((text) => ({ text }));

describe('the items of a create', () => {
  it('leaves prompt_type out for set-from-wording and sends it for a chosen type', () => {
    const [left] = buildItems(values(), lines('Which CRM?'));
    expect(left).toBeDefined();
    expect(Object.hasOwn(left ?? {}, 'prompt_type')).toBe(false);
    const [chosen] = buildItems(values({ promptType: 'comparison' }), lines('Which CRM?'));
    expect(chosen).toMatchObject({ prompt_type: 'comparison' });
  });

  it('sends is_branded only when the person touched the control', () => {
    const key = (item: Schemas['PromptCreate'] | undefined): boolean => Object.hasOwn(item ?? {}, 'is_branded');
    expect(key(buildItems(values({ branded: null }), lines('Which CRM?'))[0])).toBe(false);
    expect(buildItems(values({ branded: true }), lines('Which CRM?'))[0]).toMatchObject({ is_branded: true });
    expect(buildItems(values({ branded: false }), lines('Which CRM?'))[0]).toMatchObject({ is_branded: false });
  });

  it('sends the market, the details as chosen and an empty term list when there is none', () => {
    expect(buildItems(values(), lines('One?', 'Two?'))).toEqual([
      {
        text: 'One?',
        language_code: 'en',
        country_iso: 'DE',
        term_ids: [],
        intent: 'unknown',
        funnel_stage: 'unknown',
        importance: 3,
      },
      {
        text: 'Two?',
        language_code: 'en',
        country_iso: 'DE',
        term_ids: [],
        intent: 'unknown',
        funnel_stage: 'unknown',
        importance: 3,
      },
    ]);
    expect(
      buildItems(
        values({ termIds: [TERM, OTHER_TERM], intent: 'commercial', funnelStage: 'bofu', importance: 5 }),
        lines('One?'),
      )[0],
    ).toMatchObject({ term_ids: [TERM, OTHER_TERM], intent: 'commercial', funnel_stage: 'bofu', importance: 5 });
  });

  it('copies the term list, so a later change to the form does not reach a request on its way', () => {
    const terms = [TERM];
    const [item] = buildItems(values({ termIds: terms }), lines('One?'));
    terms.push(OTHER_TERM);
    expect(item?.term_ids).toEqual([TERM]);
  });
});

describe('the body of a create', () => {
  it('skips what is already tracked, as the server says so and never errors on a copy', () => {
    expect(buildCreateBody(values(), lines('One?')).on_duplicate).toBe('skip');
  });

  it('takes 1,000 items in one request and refuses 1,001 with a named error', () => {
    const many = (n: number): { text: string }[] =>
      Array.from({ length: n }, (_, i) => ({ text: `Question ${String(i)}?` }));
    expect(buildCreateBody(values(), many(1000)).items).toHaveLength(1000);
    expect(() => buildCreateBody(values(), many(1001))).toThrow(RangeError);
    expect(() => buildCreateBody(values(), many(1001))).toThrow('at most 1,000');
    expect(() => buildCreateBody(values(), [])).toThrow('at least one');
  });
});

describe('the prompts to bring back', () => {
  const classified = (): ClassifiedLine[] =>
    classifyLines({
      read: readPromptLines('Archived one?\nArchived one?\nFresh one?\nArchived two?'),
      lint: [
        {
          text: 'Archived one?',
          is_branded: false,
          matched_aliases: [],
          warnings: [],
          suggested_prompt_type: 'question',
          tracked: { prompt_id: ARCHIVED, is_active: false },
        },
        {
          text: 'Archived two?',
          is_branded: false,
          matched_aliases: [],
          warnings: [],
          suggested_prompt_type: 'question',
          tracked: { prompt_id: '00000000-0000-4000-8000-0000000000b2', is_active: false },
        },
        {
          text: 'Fresh one?',
          is_branded: false,
          matched_aliases: [],
          warnings: [],
          suggested_prompt_type: 'question',
        },
      ],
      existingKeys: new Set([promptKeyOf('Unrelated?', 'en', 'DE')]),
      languageCode: 'en',
      countryIso: 'DE',
    });

  it('lists the archived prompts once each, in line order, only while the restore is on', () => {
    expect(restoreIds(classified(), true)).toEqual([ARCHIVED, '00000000-0000-4000-8000-0000000000b2']);
    expect(restoreIds(classified(), false)).toEqual([]);
  });

  it('lists none when no line is archived', () => {
    expect(restoreIds([], true)).toEqual([]);
  });
});
