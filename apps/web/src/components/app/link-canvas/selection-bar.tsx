'use client';

import { useTranslations } from 'next-intl';
import type { KeyboardEvent, ReactElement } from 'react';

import { Button } from '@/components/ui/button';

export interface SelectionBarProps {
  count: number;
  /** Left out for a person who cannot write: they get no Set tier. */
  onSetTier?: (() => void) | undefined;
  onShowLinks: () => void;
  onClear: () => void;
}

/** "N cards selected" with Set tier, Show their links and Clear (spec 7.5 "Selecting and moving"). */
export function SelectionBar({ count, onSetTier, onShowLinks, onClear }: SelectionBarProps): ReactElement {
  const t = useTranslations('linkCanvas.selection');
  // Escape on any of the buttons clears, as it does on the canvas
  const escape = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClear();
  };
  return (
    <div
      role="region"
      aria-label={t('label')}
      data-canvas-control=""
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-elevated py-1 pr-1 pl-3 shadow-popover"
    >
      <span className="type-body-strong whitespace-nowrap text-primary-text">{t('count', { count })}</span>
      {onSetTier === undefined ? null : (
        <Button variant="secondary" size="sm" onClick={onSetTier} onKeyDown={escape}>
          {t('setTier')}
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={onShowLinks} onKeyDown={escape}>
        {t('showLinks')}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear} onKeyDown={escape}>
        {t('clear')}
      </Button>
    </div>
  );
}
