'use client';

/**
 * The Add card slot (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, section 2.7): a dashed cell after
 * the last card that opens the catalog. The grid decides whether there is one (fewer than 12 cards, a way to add).
 */
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { spanOf, trailingSpace, type CardItem } from '@/lib/layouts';
import { cn } from '@/lib/utils';

export interface AddCardSlotProps {
  /** Where the card goes: the end of the document's cards. */
  index: number;
  onAdd: (index: number) => void;
  /** The cards on the page, for the width of the slot. */
  cards: readonly CardItem[];
}

// The spans of `SPAN_CLASS.third` and `.half` (layout-grid.tsx, which imports this file and so cannot be imported here)
const THIRD = 'col-span-12 md:col-span-6 xl:col-span-4';
const HALF = 'col-span-12 md:col-span-6';

/** A third of the row when a third is what the last row leaves at the wide breakpoint, else half a row. */
export function addSlotClass(cards: readonly CardItem[]): string {
  return trailingSpace(cards, 'wide') === spanOf('third', 'wide') ? THIRD : HALF;
}

/** A place for the next card. Focus comes here when the last card is hidden (`data-add-card-slot`). */
export function AddCardSlot({ index, onAdd, cards }: AddCardSlotProps): ReactElement {
  const t = useTranslations('layouts.core');
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <button
      type="button"
      data-add-card-slot=""
      aria-labelledby={labelId}
      aria-describedby={hintId}
      onClick={() => {
        onAdd(index);
      }}
      className={cn(
        'flex min-h-30 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong type-body-strong text-primary-text hover:bg-surface-hover focus-visible:focus-ring',
        addSlotClass(cards),
      )}
    >
      <span id={labelId} className="flex items-center gap-1.5">
        <Icon icon={Plus} />
        {t('addCard')}
      </span>
      <span id={hintId} className="type-meta text-foreground-secondary">
        {t('addCardHint')}
      </span>
    </button>
  );
}
