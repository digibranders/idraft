'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button, type ButtonProps } from './button';
import { Icon, type IconSize } from './icon';
import { Tooltip } from './tooltip';

export type IconButtonSize = 'icon-xs' | 'icon-sm' | 'icon';

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children' | 'icon' | 'loading' | 'aria-label'> {
  icon: LucideIcon;
  /** The accessible name and the tooltip text. It names the action and never contains the word "button". */
  label: string;
  /** 24, 32 or 36 px. */
  size?: IconButtonSize | undefined;
  /** Key ids such as `['mod', 'k']`: shown in the tooltip and exposed as `aria-keyshortcuts`. */
  shortcut?: readonly string[] | undefined;
  /** The top bar draws its icons at 18 px (07-icons.md section 2). Everywhere else the size of the button decides. */
  iconSize?: Extract<IconSize, 'md'> | undefined;
  /** `bottom` in the top bar and in table headers, `right` in the collapsed sidebar. */
  tooltipSide?: 'top' | 'bottom' | 'right' | undefined;
}

const ICON_SIZE: Readonly<Record<IconButtonSize, IconSize>> = { 'icon-xs': 'sm', 'icon-sm': 'sm', icon: 'default' };

/** An icon-only button with a required name and a tooltip that says the same (09-buttons-controls.md section 3). */
export function IconButton({
  icon,
  label,
  size = 'icon-sm',
  variant = 'ghost',
  shortcut,
  iconSize,
  tooltipSide = 'top',
  ...props
}: IconButtonProps): ReactElement {
  return (
    <Tooltip content={label} purpose="label" side={tooltipSide} shortcut={shortcut}>
      <Button data-slot="icon-button" variant={variant} size={size} aria-label={label} {...props}>
        <Icon icon={icon} size={iconSize ?? ICON_SIZE[size]} />
      </Button>
    </Tooltip>
  );
}
