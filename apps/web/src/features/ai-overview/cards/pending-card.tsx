'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { CardProps } from '@/features/layouts';
import { cardName } from '@/lib/layouts';

/**
 * What a card of the catalog shows until its package builds it (WP-34 to 37): the panel of `ChartFrame` (border,
 * 16 px padding, `type-section-title` title row) with the catalog title and one honest sentence, as tall as the
 * skeleton and the finished card (title row, then 180 px). It is not a `ChartFrame` because that frame offers the
 * Table view and the menu as soon as it has something to show, and its empty state indents the text. The card
 * keeps its place in the person's layout.
 */
export default function PendingCard({ item }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.pending');
  return (
    <section
      data-slot="pending-card"
      className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="type-section-title">{cardName(item)}</h2>
      <div className="flex flex-col gap-1">
        <p className="type-subsection-title">{t('title')}</p>
        <p className="type-body text-foreground-secondary">{t('reason')}</p>
      </div>
    </section>
  );
}
