import { FACET_IDS, type FacetId } from './url-keys';
import type { EnumFilterField, FilterOption, FilterValues } from '@/components/app/filters/types';
import { enumValuesOf } from '@/lib/filters/filter-values';
import type { Prompt } from '@/lib/api/types';

/**
 * The facets of the Prompts tab (WP-17 plan D1): Intent, Funnel stage, Importance, Type and Language are
 * filters over the prompts the page has already read, so they cost no request. A prompt matches when it has any
 * chosen value of every facet that has one. `unknown` is a value of its own, never "no constraint".
 */

/** Every value the API takes, in the API's order, so a valid value in a link is never dropped for being absent. */
export const INTENTS: readonly Prompt['intent'][] = [
  'informational',
  'navigational',
  'commercial',
  'transactional',
  'local',
  'unknown',
];
export const FUNNEL_STAGES: readonly Prompt['funnel_stage'][] = ['tofu', 'mofu', 'bofu', 'retention', 'unknown'];
export const PROMPT_TYPES: readonly Prompt['prompt_type'][] = [
  'question',
  'comparison',
  'recommendation',
  'how_to',
  'definition',
  'local',
  'transactional',
  'other',
];
export const IMPORTANCES: readonly string[] = ['1', '2', '3', '4', '5'];

/** The values chosen on each facet; an empty list is no constraint. */
export type FacetSelection = Readonly<Record<FacetId, readonly string[]>>;
export const NO_FACETS: FacetSelection = { intent: [], funnel: [], importance: [], lang: [], ptype: [] };

/** A value in the one form prompts and links are compared in: importance as a number, a language in lower case. */
function canonical(id: FacetId, value: string): string {
  if (id === 'importance') {
    const number = Number(value);
    return value.trim() !== '' && Number.isFinite(number) ? String(number) : value;
  }
  return id === 'lang' ? value.toLowerCase() : value;
}

/** What a prompt has for a facet, in the form `matchesFacets` compares in. */
export function promptFacetValue(prompt: Prompt, id: FacetId): string {
  switch (id) {
    case 'intent':
      return prompt.intent;
    case 'funnel':
      return prompt.funnel_stage;
    case 'importance':
      return String(prompt.importance);
    case 'lang':
      return prompt.language_code.toLowerCase();
    case 'ptype':
      return prompt.prompt_type;
  }
}

/** AND across the facets, OR inside one; a facet with no value puts no constraint. */
export function matchesFacets(prompt: Prompt, selection: FacetSelection): boolean {
  return FACET_IDS.every((id) => {
    const chosen = selection[id];
    if (chosen.length === 0) return true;
    const has = promptFacetValue(prompt, id);
    return chosen.some((value) => canonical(id, value) === has);
  });
}

/** The facets the filter bar's values hold: only the five fields are read. */
export function facetSelectionOf(values: FilterValues): FacetSelection {
  return {
    intent: enumValuesOf(values.intent),
    funnel: enumValuesOf(values.funnel),
    importance: enumValuesOf(values.importance),
    lang: enumValuesOf(values.lang),
    ptype: enumValuesOf(values.ptype),
  };
}

/** How many facets have a value (the filters a person has set), not how many values. */
export const facetsActive = (selection: FacetSelection): number =>
  FACET_IDS.filter((id) => selection[id].length > 0).length;

/** Words come from the message catalog; the model never holds a visible string. */
export interface FacetWords {
  field: (id: FacetId) => string;
  option: (id: FacetId, value: string) => string;
}

/** The catalog key of an API value: `how_to` is `howTo` (message keys are camel case). */
export const facetOptionKey = (value: string): string =>
  value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const API_VALUES: Readonly<Record<Exclude<FacetId, 'lang'>, readonly string[]>> = {
  intent: INTENTS,
  funnel: FUNNEL_STAGES,
  importance: IMPORTANCES,
  ptype: PROMPT_TYPES,
};

/**
 * The options of a facet. Intent, Funnel stage, Importance and Type list every API value, each with the prompts
 * that have it. Language lists the codes the prompts carry, most prompts first, then by code. A count is null
 * while the list is not whole (`countsKnown` false): a partial count is not shown as if it were the project's.
 */
export function facetOptions(
  id: FacetId,
  prompts: readonly Prompt[],
  words: FacetWords,
  countsKnown: boolean,
): FilterOption[] {
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    const value = promptFacetValue(prompt, id);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values =
    id === 'lang'
      ? [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
      : API_VALUES[id];
  return values.map((value) => ({
    value,
    label: words.option(id, value),
    count: countsKnown ? (counts.get(value) ?? 0) : null,
  }));
}

/** The five fields of the bar, in the order a person reads them. Only Language waits for the list. */
export function facetFields(prompts: readonly Prompt[], words: FacetWords, loading: boolean): EnumFilterField[] {
  const order: readonly FacetId[] = ['intent', 'funnel', 'importance', 'ptype', 'lang'];
  return order.map((id) => ({
    id,
    kind: 'enum',
    label: words.field(id),
    multi: true,
    options: facetOptions(id, prompts, words, !loading),
    ...(id === 'lang' ? { optionsLoading: loading } : {}),
  }));
}
