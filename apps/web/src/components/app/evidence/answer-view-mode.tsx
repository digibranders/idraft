'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { SegmentedControl, type SegmentedControlItem } from '@/components/ui/segmented-control';

/** The three ways to read one answer (inventory 15.18): the marked text, the markdown rendered, the provider's raw reply. */
export type AnswerView = 'evidence' | 'formatted' | 'raw';

export interface AnswerViewModeProps {
  value: AnswerView;
  onValueChange: (value: AnswerView) => void;
  /** Raw is the provider's reply as received: only for a member with `raw:read`. */
  canViewRaw: boolean;
}

/** A radio group named "Answer view" that switches what the answer section shows; the choice is not kept in the URL. */
export function AnswerViewMode({ value, onValueChange, canViewRaw }: AnswerViewModeProps): ReactElement {
  const t = useTranslations('evidence.viewMode');
  const items: SegmentedControlItem<AnswerView>[] = [
    { value: 'evidence', label: t('evidence') },
    { value: 'formatted', label: t('formatted') },
    ...(canViewRaw ? [{ value: 'raw' as const, label: t('raw') }] : []),
  ];
  return (
    <SegmentedControl<AnswerView>
      semantics="view"
      size="sm"
      label={t('label')}
      value={value}
      // Only the mode: the primitive's event details are not part of this part's contract
      onValueChange={(next) => onValueChange(next)}
      items={items}
    />
  );
}
