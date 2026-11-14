'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

export interface TippedIconButtonProps extends Omit<
  ButtonProps,
  'size' | 'children' | 'icon' | 'loading' | 'aria-label'
> {
  icon: LucideIcon;
  /** The accessible name: names the card it acts on. */
  label: string;
  /** What the tooltip says: a short word for the action, added to the name as its description. */
  tip: string;
}

/**
 * An icon button of a card's toolbar whose tooltip says something other than its name ("Move" on the button named
 * "Move Key changes"). `IconButton` repeats the name, so it cannot. Like it, this passes its props and its ref on,
 * so a menu or a popover can use it as its trigger.
 */
export function TippedIconButton({
  icon,
  label,
  tip,
  variant = 'ghost',
  ...props
}: TippedIconButtonProps): ReactElement {
  return (
    <Tooltip content={tip}>
      <Button data-slot="icon-button" variant={variant} size="icon-sm" icon={icon} aria-label={label} {...props} />
    </Tooltip>
  );
}
