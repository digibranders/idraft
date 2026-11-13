'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useLayoutScreen } from '../layout-provider';
import { Badge } from '@/components/ui/badge';

/** "Customizing", after the page title while the screen is in customize mode; nothing in view mode. */
export function CustomizingBadge(): ReactElement | null {
  const t = useTranslations('layouts.customize.mode');
  const { mode } = useLayoutScreen();
  return mode === 'customize' ? <Badge tone="info">{t('badge')}</Badge> : null;
}
