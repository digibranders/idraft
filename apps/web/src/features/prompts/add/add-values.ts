import { z } from 'zod';

import type { PayloadValues } from './add-payload';
import { readPromptLines } from '../prompt-model';
import type { TopicSelection } from '../topic-picker/topic-picker-model';
import type { Schemas } from '@/lib/api/types';

/**
 * What the Add prompts form holds and the rules it is read by: the starting values, the schema, and the part of
 * it that `bulk-create` takes. No React and no request.
 */

export type PromptType = NonNullable<Schemas['PromptCreate']['prompt_type']>;
export type Intent = Schemas['PromptCreate']['intent'];
export type FunnelStage = Schemas['PromptCreate']['funnel_stage'];

export const PROMPT_TYPES = [
  'question',
  'comparison',
  'recommendation',
  'how_to',
  'definition',
  'local',
  'transactional',
  'other',
] as const satisfies readonly PromptType[];
export const INTENTS = [
  'unknown',
  'informational',
  'commercial',
  'transactional',
  'navigational',
  'local',
] as const satisfies readonly Intent[];
export const FUNNEL_STAGES = ['unknown', 'tofu', 'mofu', 'bofu', 'retention'] as const satisfies readonly FunnelStage[];
/** A Select's values are strings: the importance as the API counts it, 1 (the highest) to 5. */
export const IMPORTANCES = ['1', '2', '3', '4', '5'] as const;
export type Importance = (typeof IMPORTANCES)[number];
export const DEFAULT_IMPORTANCE: Importance = '3';
export const BRANDED_CHOICES = ['auto', 'always', 'never'] as const;

/** `auto`: "Set from wording", which sends no type. */
export type PromptTypeChoice = 'auto' | PromptType;
/** `auto`: "Set from brand names", which sends no flag. */
export type BrandedChoice = (typeof BRANDED_CHOICES)[number];

export interface AddValues {
  text: string;
  language_code: string;
  country_iso: string;
  /** Terms that exist, and paths to make when the form is saved (`useEnsureTopics`). */
  topics: TopicSelection[];
  prompt_type: PromptTypeChoice;
  intent: Intent;
  funnel_stage: FunnelStage;
  importance: Importance;
  branded: BrandedChoice;
}

export interface AddDefaults {
  languageCode: string | null;
  countryIso: string | null;
  termId?: string | null | undefined;
}

export const initialValues = (defaults: AddDefaults): AddValues => ({
  text: '',
  language_code: defaults.languageCode ?? 'en',
  country_iso: defaults.countryIso ?? '',
  topics:
    defaults.termId === null || defaults.termId === undefined ? [] : [{ kind: 'existing', termId: defaults.termId }],
  prompt_type: 'auto',
  intent: 'unknown',
  funnel_stage: 'unknown',
  importance: DEFAULT_IMPORTANCE,
  branded: 'auto',
});

/** The values `bulk-create` takes: a type and a branded flag only when the person chose one. */
export const payloadValuesOf = (values: AddValues, termIds: readonly string[]): PayloadValues => ({
  languageCode: values.language_code,
  countryIso: values.country_iso,
  termIds,
  promptType: values.prompt_type === 'auto' ? null : values.prompt_type,
  intent: values.intent,
  funnelStage: values.funnel_stage,
  importance: Number(values.importance),
  branded: values.branded === 'auto' ? null : values.branded === 'always',
});

export interface SchemaInput {
  /** The countries the enabled engines all ask in: a country outside them is not a choice. */
  offeredCountries: readonly string[];
  messages: { textRequired: string; languageRequired: string; countryRequired: string };
}

/**
 * The rules the fields can say alone. That a list is not longer than one add takes (1,000 lines that would be
 * sent) is the submit's: it depends on what the check found tracked, which the schema is not given.
 */
export function addSchema({ offeredCountries, messages }: SchemaInput): z.ZodType<AddValues, AddValues> {
  return z
    .object({
      text: z.string(),
      language_code: z.string().min(1, { error: messages.languageRequired }),
      country_iso: z.string().refine((value) => offeredCountries.includes(value), { error: messages.countryRequired }),
      topics: z.array(z.custom<TopicSelection>()),
      prompt_type: z.enum(['auto', ...PROMPT_TYPES]),
      intent: z.enum(INTENTS),
      funnel_stage: z.enum(FUNNEL_STAGES),
      importance: z.enum(IMPORTANCES),
      branded: z.enum(BRANDED_CHOICES),
    })
    .superRefine((values, context) => {
      if (readPromptLines(values.text).lines.length === 0) {
        context.addIssue({ code: 'custom', path: ['text'], message: messages.textRequired });
      }
    });
}
