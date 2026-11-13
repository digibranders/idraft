'use client';

// T7 stub: Hide only. T8 replaces this file whole (Width, Options, Hide, More).
import { EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useLayoutScreen } from './layout-provider';
import { IconButton } from '@/components/ui/icon-button';
import { cardName, type CardItem } from '@/lib/layouts';

export function CardTools({ item }: { item: CardItem }): ReactElement {
  const t = useTranslations('layouts.core');
  const { actions } = useLayoutScreen();
  return (
    <IconButton
      icon={EyeOff}
      label={t('hide', { card: cardName(item) })}
      onClick={() => {
        actions.hideCard(item.id);
      }}
    />
  );
}
