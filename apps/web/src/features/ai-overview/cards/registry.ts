import { ACTIVITY_CARDS } from './activity';
import { COMPETITOR_CARDS } from './competitors';
import { ENGINE_CARDS } from './engines';
import { PendingSkeleton } from './pending-skeleton';
import { SOURCE_CARDS } from './sources';
import { TOPIC_CARDS } from './topics';
import { defineCards, type CardRegistration } from '@/features/layouts';
import { CARD_TYPES } from '@/lib/layouts';

/** Every active card type of the `ai_overview` screen shows the pending card until its package lists it. */
const PENDING: CardRegistration = { load: () => import('./pending-card'), skeleton: PendingSkeleton };

/**
 * The registrations of the screen: a pending entry for every active catalog key of `ai_overview`, then the family
 * maps over them, so a card listed in a family replaces its placeholder. A family that lists a type the catalog does
 * not have for this screen (a typo, a retired type) throws, so it fails in the tests and not for the person.
 */
export function cardEntries(
  families: readonly Readonly<Record<string, CardRegistration>>[],
): Record<string, CardRegistration> {
  const entries: Record<string, CardRegistration> = {};
  for (const type of CARD_TYPES) {
    if (type.status === 'active' && type.screens.includes('ai_overview')) entries[type.key] = PENDING;
  }
  for (const family of families) {
    for (const [key, registration] of Object.entries(family)) {
      if (!Object.hasOwn(entries, key)) {
        throw new Error(`The card type "${key}" is not an active card type of the ai_overview screen`);
      }
      entries[key] = registration;
    }
  }
  return entries;
}

/** The registry of the page, built once at module level as `defineCards` asks. */
export const AI_OVERVIEW_CARDS = defineCards(
  cardEntries([ENGINE_CARDS, COMPETITOR_CARDS, TOPIC_CARDS, SOURCE_CARDS, ACTIVITY_CARDS]),
);
