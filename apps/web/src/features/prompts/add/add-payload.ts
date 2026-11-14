import type { ClassifiedLine } from './add-model';
import { BULK_MAX } from '../prompt-model';
import type { Schemas } from '@/lib/api/types';

/**
 * What the Add prompts dialog sends (contract C1): the items of one `bulk-create` and the ids of the archived
 * prompts to bring back. Pure. A member the person did not choose is not sent, so the server rule sets it.
 */

export interface PayloadValues {
  languageCode: string;
  countryIso: string;
  termIds: readonly string[];
  /** `null`: "Set from wording", sends nothing. */
  promptType: NonNullable<Schemas['PromptCreate']['prompt_type']> | null;
  intent: Schemas['PromptCreate']['intent'];
  funnelStage: Schemas['PromptCreate']['funnel_stage'];
  importance: number;
  /** `null`: "Set from brand names", sends nothing; a boolean is the person's override. */
  branded: boolean | null;
}

/** One item for each line: the market and the shared details, `prompt_type` and `is_branded` only when chosen. */
export function buildItems(values: PayloadValues, lines: readonly { text: string }[]): Schemas['PromptCreate'][] {
  return lines.map((line): Schemas['PromptCreate'] => ({
    text: line.text,
    language_code: values.languageCode,
    country_iso: values.countryIso,
    term_ids: [...values.termIds],
    intent: values.intent,
    funnel_stage: values.funnelStage,
    importance: values.importance,
    ...(values.promptType === null ? {} : { prompt_type: values.promptType }),
    ...(values.branded === null ? {} : { is_branded: values.branded }),
  }));
}

/** The body of one `bulk-create`: what the project already has is skipped, never an error. */
export function buildCreateBody(
  values: PayloadValues,
  lines: readonly { text: string }[],
): Schemas['PromptBulkCreate'] {
  if (lines.length === 0) throw new RangeError('A create needs at least one line to send.');
  if (lines.length > BULK_MAX) {
    throw new RangeError(
      `A create takes at most 1,000 prompts in one request, and ${String(lines.length)} were given.`,
    );
  }
  return { items: buildItems(values, lines), on_duplicate: 'skip' };
}

/** The archived prompts the lines name, once each, in line order; none while the restore is off. */
export function restoreIds(lines: readonly ClassifiedLine[], restore: boolean): string[] {
  if (!restore) return [];
  const ids = lines.flatMap((line) => (line.group === 'archived' && line.promptId !== null ? [line.promptId] : []));
  return [...new Set(ids)];
}
