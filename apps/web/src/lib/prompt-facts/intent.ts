import type { PromptIntent } from './types';

/** The intents a prompt can be classified with; `local` and `unknown` are in the API's enum too. */
export type KnownIntent = Exclude<PromptIntent, 'unknown'>;

/**
 * Plain English names and one-line meanings of the intents, as data for a column. They are defaults: a screen routes
 * them through its messages file.
 */
export const INTENT_LABEL: Readonly<Record<KnownIntent, { label: string; tip: string }>> = {
  informational: { label: 'Informational', tip: 'The asker wants to learn something' },
  commercial: { label: 'Commercial', tip: 'The asker is choosing between options' },
  transactional: { label: 'Transactional', tip: 'The asker is ready to buy or sign up' },
  navigational: { label: 'Navigational', tip: 'The asker is looking for a named brand' },
  local: { label: 'Local', tip: 'The asker wants something near a place' },
};

/** The order an intent filter or sort lists them in. */
export const INTENT_ORDER: readonly KnownIntent[] = [
  'informational',
  'commercial',
  'transactional',
  'navigational',
  'local',
];

export type IntentReading =
  | { state: 'ok'; intent: KnownIntent; label: string; tip: string }
  /** `not_collected`: the row has no intent field. `unclassified`: the API says `unknown`. */
  | { state: 'unknown'; reason: 'not_collected' | 'unclassified' };

export function intentOf(intent: PromptIntent | undefined): IntentReading {
  if (intent === undefined) return { state: 'unknown', reason: 'not_collected' };
  if (intent === 'unknown') return { state: 'unknown', reason: 'unclassified' };
  return { state: 'ok', intent, ...INTENT_LABEL[intent] };
}
