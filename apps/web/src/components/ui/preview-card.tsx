'use client';

import { PreviewCard as PreviewCardPrimitive } from '@base-ui/react/preview-card';
import type { ReactElement, ReactNode } from 'react';

import { POPUP_COLLISION, POPUP_MOTION, POPUP_SURFACE } from './popup-styles';
import { cn } from '@/lib/utils';

/** A card opens 600 ms after the pointer rests on its link and closes 300 ms after it leaves (16 section 6.3). */
const OPEN_DELAY_MS = 600;
const CLOSE_DELAY_MS = 300;

export interface PreviewCardProps {
  /** The link the card belongs to. It must pass its props and its ref on to a DOM element. */
  trigger: ReactElement;
  /** Names the card for assistive technology. */
  label: string;
  children: ReactNode;
  side?: 'bottom' | 'top' | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
  className?: string | undefined;
}

/**
 * A read-only summary that opens when the pointer rests on, or keyboard focus reaches, a link to an object
 * (16-drawers-dialogs-popovers.md section 6.3). The pointer can move onto the card without it closing, so the
 * links inside it work. The card never holds actions; everything in it is reachable by opening the object.
 */
export function PreviewCard({
  trigger,
  label,
  children,
  side = 'bottom',
  align = 'start',
  className,
}: PreviewCardProps): ReactElement {
  return (
    <PreviewCardPrimitive.Root>
      <PreviewCardPrimitive.Trigger render={trigger} delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS} />
      <PreviewCardPrimitive.Portal>
        <PreviewCardPrimitive.Positioner
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          collisionAvoidance={POPUP_COLLISION}
          className="z-(--z-dropdown)"
        >
          <PreviewCardPrimitive.Popup
            data-slot="preview-card"
            aria-label={label}
            className={cn('flex max-w-(--available-width) flex-col p-4', POPUP_SURFACE, POPUP_MOTION, className)}
          >
            {children}
          </PreviewCardPrimitive.Popup>
        </PreviewCardPrimitive.Positioner>
      </PreviewCardPrimitive.Portal>
    </PreviewCardPrimitive.Root>
  );
}
