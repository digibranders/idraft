import { describe, expect, it } from 'vitest';

import { addSchema, initialValues, payloadValuesOf, type AddValues } from './add-values';

const MESSAGES = {
  textRequired: 'Enter at least one prompt.',
  languageRequired: 'Choose a language.',
  countryRequired: 'Choose a country.',
};
const schemaFor = (offered: readonly string[] = ['DE', 'IN']): ReturnType<typeof addSchema> =>
  addSchema({ offeredCountries: offered, messages: MESSAGES });
const values = (extra: Partial<AddValues> = {}): AddValues => ({
  ...initialValues({ languageCode: 'en', countryIso: 'DE' }),
  text: 'Which agency audits shop sites?',
  ...extra,
});
const issuesOf = (input: AddValues, schema = schemaFor()): string[] => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('the starting values', () => {
  it('start on the project language and country, with no topic and every detail left to the server', () => {
    expect(initialValues({ languageCode: 'de', countryIso: 'DE' })).toEqual({
      text: '',
      language_code: 'de',
      country_iso: 'DE',
      topics: [],
      prompt_type: 'auto',
      intent: 'unknown',
      funnel_stage: 'unknown',
      importance: '3',
      branded: 'auto',
    });
  });

  it('fall back to English and no country, and choose the topic the dialog was opened from', () => {
    expect(initialValues({ languageCode: null, countryIso: null, termId: 'term-1' })).toMatchObject({
      language_code: 'en',
      country_iso: '',
      topics: [{ kind: 'existing', termId: 'term-1' }],
    });
  });
});

describe('what the values send', () => {
  it('sends no type for "Set from wording" and the type for a chosen one', () => {
    expect(payloadValuesOf(values(), []).promptType).toBeNull();
    expect(payloadValuesOf(values({ prompt_type: 'how_to' }), []).promptType).toBe('how_to');
  });

  it('sends no branded flag for "Set from brand names", true for always and false for never', () => {
    expect(payloadValuesOf(values(), []).branded).toBeNull();
    expect(payloadValuesOf(values({ branded: 'always' }), []).branded).toBe(true);
    expect(payloadValuesOf(values({ branded: 'never' }), []).branded).toBe(false);
  });

  it('sends the details as chosen, importance as a number, and the topics it was given', () => {
    expect(
      payloadValuesOf(values({ intent: 'commercial', funnel_stage: 'bofu', importance: '1' }), ['term-1']),
    ).toEqual({
      languageCode: 'en',
      countryIso: 'DE',
      termIds: ['term-1'],
      promptType: null,
      intent: 'commercial',
      funnelStage: 'bofu',
      importance: 1,
      branded: null,
    });
  });
});

describe('the schema', () => {
  it('accepts a list for an offered country and a language', () => {
    expect(issuesOf(values())).toEqual([]);
  });

  it('asks for a prompt when the field holds only blank lines', () => {
    expect(issuesOf(values({ text: '\n   \n' }))).toEqual(['text: Enter at least one prompt.']);
  });

  it('asks for a language, and for a country that is offered', () => {
    expect(issuesOf(values({ language_code: '' }))).toEqual(['language_code: Choose a language.']);
    expect(issuesOf(values({ country_iso: 'FR' }))).toEqual(['country_iso: Choose a country.']);
    expect(issuesOf(values({ country_iso: '' }))).toEqual(['country_iso: Choose a country.']);
  });
});
