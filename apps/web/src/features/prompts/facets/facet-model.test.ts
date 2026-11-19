import { describe, expect, it } from 'vitest';

import {
  facetFields,
  facetOptionKey,
  facetOptions,
  facetSelectionOf,
  facetsActive,
  FUNNEL_STAGES,
  IMPORTANCES,
  INTENTS,
  matchesFacets,
  NO_FACETS,
  promptFacetValue,
  PROMPT_TYPES,
  type FacetSelection,
  type FacetWords,
} from './facet-model';
import { FACET_IDS, FILTER_URL_KEYS } from './url-keys';
import type { FilterValues } from '@/components/app/filters/types';
import type { Prompt } from '@/lib/api/types';
import { EVENTUS_DEFINITION } from '@/mocks/ai-prompt-definition';
import messages from '../../../../messages/en.json';

const AT = '2026-11-12T12:00:00Z';

/** A prompt with only the facet fields that matter to a test set; the rest is what any prompt has. */
function promptOf(index: number, facets: Partial<Prompt> = {}): Prompt {
  const id = (kind: number): string => `${String(kind).repeat(8)}-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return {
    prompt_id: id(1),
    country_iso: 'DE',
    created_at: AT,
    created_by: null,
    creation_method: 'human',
    current_version: {
      change_kind: 'initial',
      created_at: AT,
      prompt_version_id: id(2),
      text: `Question number ${String(index)}?`,
      text_hash: 'a'.repeat(64),
      version_no: 1,
    },
    funnel_stage: 'unknown',
    importance: 3,
    intent: 'unknown',
    is_active: true,
    is_branded: false,
    is_branded_source: 'computed',
    language_code: 'en',
    prompt_type: 'question',
    prompt_type_source: 'rule',
    source: 'manual',
    terms: [],
    updated_at: AT,
    ...facets,
  };
}

/** The 72 prompts of Eventus Security (intent, funnel stage, type, importance, branded), all English. */
const EVENTUS: readonly Prompt[] = EVENTUS_DEFINITION.prompts.map((prompt, index) =>
  promptOf(index + 1, {
    intent: prompt.intent,
    funnel_stage: prompt.funnel_stage,
    prompt_type: prompt.prompt_type,
    importance: prompt.importance,
    is_branded: prompt.branded,
  }),
);

const WORDS: FacetWords = {
  field: (id) => `field:${id}`,
  option: (id, value) => `${id}:${value}`,
};

const selection = (chosen: Partial<Record<(typeof FACET_IDS)[number], readonly string[]>>): FacetSelection => ({
  ...NO_FACETS,
  ...chosen,
});

const countOf = (options: readonly { value: string; count?: number | null | undefined }[], value: string): unknown =>
  options.find((option) => option.value === value)?.count;

describe('the URL keys of the filters', () => {
  it('names the four filters then the five facets, once each, and no scope or layout key', () => {
    expect(FILTER_URL_KEYS).toEqual([
      'topic',
      'engine',
      'branded',
      'detectable',
      'intent',
      'funnel',
      'importance',
      'lang',
      'ptype',
    ]);
    expect(FACET_IDS).toEqual(['intent', 'funnel', 'importance', 'lang', 'ptype']);
    expect(new Set(FILTER_URL_KEYS).size).toBe(FILTER_URL_KEYS.length);
  });
});

describe('the options of a facet', () => {
  it('lists every API value of intent, funnel stage and type, in the API order, with the project counts', () => {
    const intent = facetOptions('intent', EVENTUS, WORDS, true);
    expect(intent.map((option) => option.value)).toEqual([
      'informational',
      'navigational',
      'commercial',
      'transactional',
      'local',
      'unknown',
    ]);
    // 34 informational, 2 navigational and 36 commercial prompts, as the fixture file counts them
    expect(intent.map((option) => option.count)).toEqual([34, 2, 36, 0, 0, 0]);
    expect(intent.map((option) => option.label)).toEqual(INTENTS.map((value) => `intent:${value}`));

    const funnel = facetOptions('funnel', EVENTUS, WORDS, true);
    expect(funnel.map((option) => option.value)).toEqual(['tofu', 'mofu', 'bofu', 'retention', 'unknown']);
    expect(funnel.map((option) => option.count)).toEqual([15, 47, 10, 0, 0]);

    const types = facetOptions('ptype', EVENTUS, WORDS, true);
    expect(types.map((option) => option.value)).toEqual([...PROMPT_TYPES]);
    expect(types.map((option) => option.value)).toEqual([
      'question',
      'comparison',
      'recommendation',
      'how_to',
      'definition',
      'local',
      'transactional',
      'other',
    ]);
    for (const option of types) {
      expect(option.count).toBe(
        EVENTUS_DEFINITION.prompts.filter((prompt) => prompt.prompt_type === option.value).length,
      );
    }

    const importance = facetOptions('importance', EVENTUS, WORDS, true);
    expect(importance.map((option) => option.value)).toEqual(['1', '2', '3', '4', '5']);
    expect(IMPORTANCES).toEqual(['1', '2', '3', '4', '5']);
    expect(countOf(importance, '1')).toBe(0);
    expect(importance.reduce((sum, option) => sum + (option.count ?? 0), 0)).toBe(72);
  });

  it('a value no prompt has is still an option with a count of 0', () => {
    const fynixLike = [promptOf(1), promptOf(2)];
    const intent = facetOptions('intent', fynixLike, WORDS, true);
    expect(intent).toHaveLength(INTENTS.length);
    expect(countOf(intent, 'commercial')).toBe(0);
    expect(countOf(intent, 'unknown')).toBe(2);
    expect(facetOptions('funnel', fynixLike, WORDS, true).map((option) => option.value)).toContain('bofu');
    expect(countOf(facetOptions('importance', fynixLike, WORDS, true), '5')).toBe(0);
  });

  it('counts are null while the list is not whole', () => {
    for (const id of FACET_IDS) {
      const options = facetOptions(id, EVENTUS, WORDS, false);
      expect(options.length).toBeGreaterThan(0);
      expect(options.map((option) => option.count)).toEqual(options.map(() => null));
    }
  });

  it('language options are the codes the prompts carry, most prompts first, named in words', () => {
    const prompts = [
      promptOf(1, { language_code: 'hi' }),
      promptOf(2, { language_code: 'en' }),
      promptOf(3, { language_code: 'en' }),
      promptOf(4, { language_code: 'en' }),
      promptOf(5, { language_code: 'hi' }),
      promptOf(6, { language_code: 'de' }),
      promptOf(7, { language_code: 'DE' }),
    ];
    const options = facetOptions('lang', prompts, WORDS, true);
    expect(options.map((option) => option.value)).toEqual(['en', 'de', 'hi']);
    expect(options.map((option) => option.count)).toEqual([3, 2, 2]);
    expect(options.map((option) => option.label)).toEqual(['lang:en', 'lang:de', 'lang:hi']);
    expect(facetOptions('lang', [], WORDS, true)).toEqual([]);
  });
});

describe('matching a prompt', () => {
  const commercialMiddle = promptOf(1, { intent: 'commercial', funnel_stage: 'mofu' });
  const commercialTop = promptOf(2, { intent: 'commercial', funnel_stage: 'tofu' });
  const informationalMiddle = promptOf(3, { intent: 'informational', funnel_stage: 'mofu' });

  it('a prompt matches when it has any chosen value of each facet and every facet with a value is met', () => {
    const chosen = selection({ intent: ['commercial', 'informational'], funnel: ['mofu'] });
    expect(matchesFacets(commercialMiddle, chosen)).toBe(true);
    expect(matchesFacets(informationalMiddle, chosen)).toBe(true);
    // Intent is met, the funnel stage is not: the facets are AND-ed, not OR-ed
    expect(matchesFacets(commercialTop, chosen)).toBe(false);
    // Inside one facet any value will do
    expect(matchesFacets(commercialTop, selection({ funnel: ['mofu', 'tofu'] }))).toBe(true);
    // A facet that is not met rejects the prompt even when the others are
    expect(matchesFacets(commercialMiddle, selection({ intent: ['commercial'], funnel: ['bofu'] }))).toBe(false);
  });

  it('an empty facet puts no constraint', () => {
    expect(matchesFacets(commercialMiddle, NO_FACETS)).toBe(true);
    expect(matchesFacets(commercialMiddle, selection({ intent: ['commercial'] }))).toBe(true);
    expect(matchesFacets(promptOf(9, { importance: 1, language_code: 'hi' }), selection({ intent: [] }))).toBe(true);
  });

  it('unknown is a value of its own: intent unknown matches the prompts whose intent is unknown, not every prompt', () => {
    const unknownIntent = promptOf(4);
    const chosen = selection({ intent: ['unknown'] });
    expect(matchesFacets(unknownIntent, chosen)).toBe(true);
    expect(matchesFacets(commercialMiddle, chosen)).toBe(false);
    expect(
      matchesFacets(promptOf(5, { funnel_stage: 'unknown', intent: 'local' }), selection({ funnel: ['unknown'] })),
    ).toBe(true);
    expect(matchesFacets(commercialTop, selection({ funnel: ['unknown'] }))).toBe(false);
  });

  it('importance is compared as a number read from the link, so 4 matches importance 4', () => {
    expect(promptFacetValue(promptOf(1, { importance: 4 }), 'importance')).toBe('4');
    expect(matchesFacets(promptOf(1, { importance: 4 }), selection({ importance: ['4'] }))).toBe(true);
    expect(matchesFacets(promptOf(2, { importance: 3 }), selection({ importance: ['4'] }))).toBe(false);
    expect(matchesFacets(promptOf(3, { importance: 4 }), selection({ importance: ['04'] }))).toBe(true);
    expect(matchesFacets(promptOf(4, { importance: 5 }), selection({ importance: ['3', '5'] }))).toBe(true);
  });

  it('a language code matches without regard to case', () => {
    expect(promptFacetValue(promptOf(1, { language_code: 'DE' }), 'lang')).toBe('de');
    expect(matchesFacets(promptOf(1, { language_code: 'DE' }), selection({ lang: ['de'] }))).toBe(true);
    expect(matchesFacets(promptOf(2, { language_code: 'de' }), selection({ lang: ['DE'] }))).toBe(true);
    expect(matchesFacets(promptOf(3, { language_code: 'en' }), selection({ lang: ['de'] }))).toBe(false);
  });

  it('reads the type of a prompt from its prompt type', () => {
    expect(promptFacetValue(promptOf(1, { prompt_type: 'how_to' }), 'ptype')).toBe('how_to');
    expect(matchesFacets(promptOf(1, { prompt_type: 'how_to' }), selection({ ptype: ['how_to'] }))).toBe(true);
    expect(matchesFacets(promptOf(2, { prompt_type: 'question' }), selection({ ptype: ['how_to'] }))).toBe(false);
  });
});

describe('the selection of the filter bar', () => {
  it('facetSelectionOf reads only the five fields and ignores the rest', () => {
    const values: FilterValues = {
      intent: { kind: 'enum', values: ['commercial', 'local'] },
      ptype: { kind: 'enum', values: ['question'] },
      lang: { kind: 'range', min: 1, max: 2 },
      topic: { kind: 'enum', values: ['a-topic'] },
      branded: { kind: 'enum', values: ['only'] },
    };
    expect(facetSelectionOf(values)).toEqual({
      intent: ['commercial', 'local'],
      funnel: [],
      importance: [],
      lang: [],
      ptype: ['question'],
    });
    expect(facetSelectionOf({})).toEqual(NO_FACETS);
  });

  it('facetsActive counts the facets, not the values', () => {
    expect(facetsActive(NO_FACETS)).toBe(0);
    expect(facetsActive(selection({ intent: ['commercial', 'local', 'unknown'] }))).toBe(1);
    expect(facetsActive(selection({ intent: ['commercial'], importance: ['1', '2'], lang: ['de'] }))).toBe(3);
  });

  it('facetFields has the five fields in order and only language waits for the list', () => {
    const whole = facetFields(EVENTUS, WORDS, false);
    expect(whole.map((field) => field.id)).toEqual(['intent', 'funnel', 'importance', 'ptype', 'lang']);
    expect(whole.map((field) => field.label)).toEqual([
      'field:intent',
      'field:funnel',
      'field:importance',
      'field:ptype',
      'field:lang',
    ]);
    expect(whole.every((field) => field.kind === 'enum' && field.multi)).toBe(true);
    expect(whole.map((field) => field.optionsLoading ?? false)).toEqual([false, false, false, false, false]);

    const loading = facetFields([], WORDS, true);
    expect(loading.map((field) => field.optionsLoading ?? false)).toEqual([false, false, false, false, true]);
    // The enum facets still list every API value while the list loads, so a link value is never dropped
    expect(loading[0]?.options).toHaveLength(INTENTS.length);
    expect(loading[0]?.options.map((option) => option.count)).toEqual(INTENTS.map(() => null));
    expect(loading[4]?.options).toEqual([]);
  });
});

describe('the words of the facets', () => {
  const fields = messages.prompts.facets.fields as unknown as Record<string, string | Record<string, string>>;
  const group = (name: string): Record<string, string> => {
    const value = fields[name];
    if (typeof value !== 'object') throw new Error(`prompts.facets.fields.${name} is missing`);
    return value;
  };

  it('names every field and every API value in the catalog', () => {
    for (const name of ['intent', 'funnel', 'importance', 'type', 'language'])
      expect(typeof fields[name]).toBe('string');
    for (const value of INTENTS) expect(typeof group('intentOptions')[facetOptionKey(value)]).toBe('string');
    for (const value of FUNNEL_STAGES) expect(typeof group('funnelOptions')[facetOptionKey(value)]).toBe('string');
    for (const value of PROMPT_TYPES) expect(typeof group('typeOptions')[facetOptionKey(value)]).toBe('string');
    expect(typeof fields.importanceOption).toBe('string');
  });

  it('reads an unknown value as Not set in all three groups', () => {
    expect(group('intentOptions').unknown).toBe('Not set');
    expect(group('funnelOptions').unknown).toBe('Not set');
    expect(fields.importanceOption).toBe('{value}');
  });

  it('writes a snake case value as the camel case key the catalog needs', () => {
    expect(facetOptionKey('how_to')).toBe('howTo');
    expect(facetOptionKey('informational')).toBe('informational');
  });

  it('no string holds a dash', () => {
    // Built from code points, so this file does not hold the characters it looks for
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(JSON.stringify(messages.prompts.facets)).not.toMatch(dashes);
  });
});
