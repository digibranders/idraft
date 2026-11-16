'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { useOverview } from '../overview-context';
import { toast } from '@/components/ui/toast';

/** Says once that a link named several platforms and the page shows All platforms. Draws nothing. */
export function SeveralPlatformsNotice(): null {
  const t = useTranslations('aiOverview.shell');
  const { platformLinkReplaced } = useOverview();
  useEffect(() => {
    if (platformLinkReplaced) {
      toast({ type: 'info', title: t('severalPlatformsTitle'), description: t('severalPlatformsDescription') });
    }
  }, [platformLinkReplaced, t]);
  return null;
}
