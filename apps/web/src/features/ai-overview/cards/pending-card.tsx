'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import { cardName } from '@/lib/layouts';

/**
 * What a card of the catalog shows until its package builds it (WP-34 to 37): its frame, its catalog title and one
 * honest sentence. It uses the frame every card uses, so a pending card has the final border, title row and height
 * and nothing moves when the real card replaces it. The card keeps its place in the person's layout.
 */
export default function PendingCard({ item }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.pending');
  const name = cardName(item);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={name}
      height={180}
      summary={t('summary', { name })}
      status="empty"
      empty={{ title: t('title'), reason: t('reason') }}
      body={null}
      table={null}
    />
  );
}
