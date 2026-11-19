'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { ALERT_DEFAULTS } from '@/components/app/link-alert-rules/alert-settings';
import { alertTierText } from '@/lib/internal-links/changes-format';
import { linkSettingsQuery } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';

/**
 * The tiers the alert setting calls important, in words ("T1 and T2"). `tiers` is `null` until the setting has loaded
 * and when it cannot be read (the copy then says "the important tiers" and never guesses); `settled` says the read
 * has ended, so a label that names the tiers can wait for it instead of changing its name when it arrives. The
 * settings read is the one the alert rules share.
 */
export function useImportantTiers(scope: LinksScope): { tiers: string | null; settled: boolean } {
  const t = useTranslations('internalLinks.context');
  const settings = useQuery(linkSettingsQuery(scope));
  if (settings.data === undefined) return { tiers: null, settled: !settings.isPending };
  const alerts = settings.data.data.internal_links?.alerts ?? ALERT_DEFAULTS;
  return {
    settled: true,
    tiers: alertTierText(alerts.max_position, {
      tierPair: (first, second) => t('tierPair', { first, second }),
      tierRange: (first, last) => t('tierRange', { first, last }),
    }),
  };
}
