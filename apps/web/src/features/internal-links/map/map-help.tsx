'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';

const LINES = [
  ['helpDotTitle', 'helpDot'],
  ['helpArrowTitle', 'helpArrow'],
  ['helpNotDrawnTitle', 'helpNotDrawn'],
  ['helpFindTitle', 'helpFind'],
  ['helpClickTitle', 'helpClick'],
  ['helpScrollTitle', 'helpScroll'],
  ['helpDragTitle', 'helpDrag'],
] as const;

/**
 * How to read the map. It sits inside the canvas, above the view controls: a popover from a button at the foot of the
 * page falls off the screen.
 */
export function MapHelp({ id }: { id: string }): ReactElement {
  const t = useTranslations('internalLinks.map');
  return (
    <div
      id={id}
      className="absolute bottom-14 left-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-elevated p-3 shadow-popover"
      style={{ width: '26rem', maxWidth: 'calc(100% - 1.5rem)', maxHeight: 'calc(100% - 5rem)' }}
    >
      <h3 className="type-subsection-title text-foreground">{t('help')}</h3>
      {/* The lines scroll on a short canvas: the region takes the keyboard while they overflow */}
      <ScrollArea maxHeight="popover" label={t('help')}>
        <dl className="flex flex-col gap-2">
          {LINES.map(([title, text]) => (
            <div key={title} className="flex flex-col gap-0.5">
              <dt className="type-body-strong text-foreground">{t(title)}</dt>
              <dd className="type-meta text-foreground-secondary">{t(text)}</dd>
            </div>
          ))}
        </dl>
      </ScrollArea>
    </div>
  );
}
