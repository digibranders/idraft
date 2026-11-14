'use client';

/**
 * What a card that this project cannot show looks like in customize mode (spec section 8, WB-LAY-37): its name,
 * why it is missing here, and that it comes back where the data exists. It goes in the frame's `notice`, outside
 * the inert body, so it is read; the card keeps its handle, its width and its More menu. View mode skips the card.
 */
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { cardName, type CardItem } from '@/lib/layouts';

export interface UnavailableCardProps {
  item: CardItem;
  /** The availability reason: "AI tracking is off in this project". */
  reason: string;
}

export function UnavailableCard({ item, reason }: UnavailableCardProps): ReactElement {
  const t = useTranslations('layouts.customize.card');
  return (
    <div
      data-slot="unavailable-card"
      className="flex min-h-30 flex-col gap-1 rounded-lg border border-border bg-surface p-4"
    >
      <p className="type-body-strong text-foreground">{cardName(item)}</p>
      <p className="flex items-start gap-2 type-meta text-warning-text">
        <Icon icon={TriangleAlert} size="sm" className="mt-px shrink-0" />
        <span>{reason}</span>
      </p>
      <p className="type-meta text-foreground-secondary">{t('placeholderNote')}</p>
    </div>
  );
}
