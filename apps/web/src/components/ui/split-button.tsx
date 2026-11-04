'use client';

import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button, type ButtonProps } from './button';
import { IconButton } from './icon-button';
import { Menu, type MenuItemDef } from './menu';
import { cn } from '@/lib/utils';

export interface SplitButtonProps extends Pick<ButtonProps, 'onClick' | 'disabled'> {
  /** The default action. */
  children: string;
  icon?: LucideIcon | undefined;
  variant?: 'primary' | 'secondary' | undefined;
  size?: 'sm' | 'md' | undefined;
  /** Names the group of the two halves ("Add keywords options"). */
  groupLabel: string;
  /** Names the menu half ("More ways to add keywords"); never contains the word "button". */
  menuLabel: string;
  /** The alternatives. They never repeat the default action. */
  items: readonly MenuItemDef[];
  onMenuOpenChange?: ((open: boolean) => void) | undefined;
}

/**
 * A default action with a menu of alternatives beside it (09-buttons-controls.md section 4). Two sibling
 * buttons share one border: the left half acts, the right half is the menu trigger, square at the button's
 * height. For `primary` the right half carries a divider in the hover color.
 */
export function SplitButton({
  children,
  icon,
  variant = 'secondary',
  size = 'md',
  groupLabel,
  menuLabel,
  items,
  onMenuOpenChange,
  onClick,
  disabled,
}: SplitButtonProps): ReactElement {
  return (
    <div role="group" aria-label={groupLabel} data-slot="split-button" className="inline-flex">
      <Button
        variant={variant}
        size={size}
        icon={icon}
        onClick={onClick}
        disabled={disabled}
        className="rounded-r-none"
      >
        {children}
      </Button>
      <Menu
        align="end"
        items={items}
        onOpenChange={onMenuOpenChange}
        trigger={
          <IconButton
            icon={ChevronDown}
            label={menuLabel}
            variant={variant}
            size={size === 'sm' ? 'icon-sm' : 'icon'}
            disabled={disabled}
            className={cn('-ml-px rounded-l-none', variant === 'primary' && 'border-l border-l-primary-hover')}
          />
        }
      />
    </div>
  );
}
