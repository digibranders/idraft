'use client';

import { useTranslations } from 'next-intl';
import { forwardRef, type ReactNode, type RefAttributes } from 'react';

import { useLayoutScreen } from './layout-provider';
import { cardName, type CardItem } from '@/lib/layouts';
import { cn } from '@/lib/utils';

export interface CardFrameProps {
  item: CardItem;
  /** Customize mode: the drag handle (sortable-grid). */
  handle?: ReactNode | undefined;
  /** Customize mode: Width, Options, Hide and More (card-toolbar). */
  tools?: ReactNode | undefined;
  /** Customize mode: the right edge (the resize grip). */
  edge?: ReactNode | undefined;
  /** 50% opacity while dragged, a ring when picked up by keyboard. */
  dragState?: 'idle' | 'dragging' | 'picked' | undefined;
  /** Layout only: the span of the grid cell (`SPAN_CLASS`). */
  className?: string | undefined;
  /** Why the card cannot show (WP-16's richer placeholder): outside the inert body, so it is read and its links work. */
  notice?: ReactNode | undefined;
  /** The card body: not reachable in customize mode, where the card is arranged and not used. */
  children: ReactNode;
}

/** One card's place on the page. In view mode it is only the cell; in customize mode it is the dashed frame with its controls. */
export const CardFrame = forwardRef<HTMLDivElement, CardFrameProps & RefAttributes<HTMLDivElement>>(function CardFrame(
  { item, handle, tools, edge, dragState = 'idle', className, notice, children },
  ref,
) {
  const t = useTranslations('layouts.core');
  const customizing = useLayoutScreen().mode === 'customize';
  return (
    <div
      ref={ref}
      data-layout-card={item.id}
      className={cn(
        'relative flex min-w-0 flex-col',
        customizing && 'rounded-lg bg-surface-subtle p-1 outline-1 outline-border-strong outline-dashed',
        dragState === 'dragging' && 'opacity-50',
        dragState === 'picked' && 'ring-2 ring-primary',
        className,
      )}
    >
      {customizing ? (
        // A group, not an ARIA toolbar: every control is an ordinary tab stop
        <div role="group" aria-label={t('toolbar', { card: cardName(item) })} className="flex items-center gap-1 pb-1">
          {handle}
          <div className="ml-auto flex items-center gap-1">{tools}</div>
        </div>
      ) : null}
      {notice === undefined ? null : <div className="min-w-0">{notice}</div>}
      {/* A filling column: the card surface stretches with the frame, so a row shares its tallest height */}
      <div inert={customizing} className="flex min-w-0 flex-1 flex-col">
        {children}
      </div>
      {customizing ? edge : null}
    </div>
  );
});
