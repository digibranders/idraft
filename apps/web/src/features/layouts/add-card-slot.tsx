'use client';

// T7 stub: a plain button. T8 replaces this file whole (the dashed slot, `addSlotClass`) and keeps `data-add-card-slot`.
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import type { CardItem } from '@/lib/layouts';

export interface AddCardSlotProps {
  /** Where the card goes: the end of the document's cards. */
  index: number;
  onAdd: (index: number) => void;
  /** The cards on the page, for the width of the slot. */
  cards: readonly CardItem[];
}

export function AddCardSlot({ index, onAdd }: AddCardSlotProps): ReactElement {
  const t = useTranslations('layouts.core');
  return (
    <Button
      data-add-card-slot=""
      className="col-span-12"
      onClick={() => {
        onAdd(index);
      }}
    >
      {t('addCard')}
    </Button>
  );
}
