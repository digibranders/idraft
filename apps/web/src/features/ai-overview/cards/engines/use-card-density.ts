'use client';

import { usePreferences } from '@/lib/preferences/preferences';
import { useMe } from '@/lib/session/use-me';
import type { Density } from '@/lib/tables/table-state';

/**
 * The row height the person chose for tables (Settings > Preferences), for the `BarList` and `StepBars` of a card.
 * Compact unless they chose 40 px rows. It is the preference and not a link key: the cards of a page share it.
 */
export function useCardDensity(): Density {
  const { user } = useMe();
  const [preferences] = usePreferences(user.user_id);
  return preferences.density;
}
