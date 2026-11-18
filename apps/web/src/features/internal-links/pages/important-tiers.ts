'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { ALERT_DEFAULTS } from '@/components/app/link-alert-rules/alert-settings';
import { alertTierText } from '@/lib/internal-links/changes-format';
import { linkSettingsQuery } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';

/**
 * The tiers the alert setting calls important, in words ("T1 and T2"), or `null` while the setting has not loaded
 * (the label then says "the important tiers" and never guesses). The settings read is the one the alert rules share.
 */
export function useImportantTiers(scope: LinksScope): string | null {
  const t = useTranslations('internalLinks.context');
  const settings = useQuery(linkSettingsQuery(scope));
  if (settings.data === undefined) return null;
  const alerts = settings.data.data.internal_links?.alerts ?? ALERT_DEFAULTS;
  return alertTierText(alerts.max_position, {
    tierPair: (first, second) => t('tierPair', { first, second }),
    tierRange: (first, last) => t('tierRange', { first, last }),
  });
}
