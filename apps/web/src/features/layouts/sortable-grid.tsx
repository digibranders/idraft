'use client';

// T7 stub: the customize frames without drag and drop. T9 replaces this file whole and keeps its props.
import { GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { CardFrame } from './card-frame';
import { CardTools } from './card-toolbar';
import { IconButton } from '@/components/ui/icon-button';
import { cardName, type CardItem } from '@/lib/layouts';

export interface SortableGridProps {
  /** The cards to arrange, in order. */
  cards: readonly CardItem[];
  /** One card's body (the registered component, its skeleton or its reason): the frame wraps it. */
  renderBody: (item: CardItem) => ReactNode;
  /** Why a card cannot show, or undefined: the frame's `notice`, outside the inert body. */
  renderNotice: (item: CardItem) => ReactNode;
  /** The grid span of one card's cell. */
  cellClass: (item: CardItem) => string;
}

/** The cells of the customize grid; the grid's own element is the parent. */
export function SortableGrid({ cards, renderBody, renderNotice, cellClass }: SortableGridProps): ReactElement {
  const t = useTranslations('layouts.core');
  return (
    <>
      {cards.map((item) => (
        <CardFrame
          key={item.id}
          item={item}
          className={cellClass(item)}
          notice={renderNotice(item)}
          handle={<IconButton icon={GripVertical} label={t('reorder', { card: cardName(item) })} data-part="handle" />}
          tools={<CardTools item={item} />}
        >
          {renderBody(item)}
        </CardFrame>
      ))}
    </>
  );
}
