'use client';

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { CardFrameProps } from './card-frame';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cardName, type CardItem } from '@/lib/layouts';

export interface DragHandleProps {
  item: CardItem;
  /** From `useSortable`: what dnd-kit puts on its activator. */
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  /** `picked`: taken with the keyboard, so the button is pressed until the card is dropped or put back. */
  dragState: NonNullable<CardFrameProps['dragState']>;
}

/**
 * The only place a card can be taken by: pointer, finger and keyboard all start here. Its name is the action on
 * the card, its description (from dnd-kit's `aria-describedby`) the keys, its tooltip the pointer hint.
 */
export function DragHandle({
  item,
  attributes,
  listeners,
  setActivatorNodeRef,
  dragState,
}: DragHandleProps): ReactElement {
  const t = useTranslations('layouts.core');
  return (
    // The tooltip repeats the name for the eye; the keys are the description dnd-kit already points at. While the
    // card is held there is no tooltip: an open one would take the first Escape, which is "put the card back"
    <Tooltip content={t('reorderTip')} purpose="label" disabled={dragState !== 'idle'}>
      <Button
        {...attributes}
        {...listeners}
        ref={setActivatorNodeRef}
        data-part="handle"
        variant="ghost"
        size="icon-sm"
        icon={GripVertical}
        aria-label={t('reorder', { card: cardName(item) })}
        aria-pressed={dragState === 'picked'}
        // "sortable" is dnd-kit's own English word: the name and the description say it in the page's language
        aria-roledescription={undefined}
        className="cursor-grab touch-none pointer-coarse:size-control-touch"
      />
    </Tooltip>
  );
}
