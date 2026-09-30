'use client';

import { CircleHelp, Keyboard } from 'lucide-react';
import type { ReactElement } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';

export interface HelpMenuProps {
  /** "Help": the button's name and tooltip. */
  label: string;
  /** "Keyboard shortcuts". */
  shortcutsLabel: string;
  onOpenShortcuts: () => void;
  /**
   * Further entries (Methodology, Documentation, Contact support) once their pages exist: links, in the
   * order of 20-accessibility.md section 15. They come first; Keyboard shortcuts is last.
   */
  links?: readonly MenuItemDef[] | undefined;
}

const SHORTCUTS = 'shortcuts';

/**
 * Help in the same place on every page (20-accessibility.md section 15, 25 section 5.10): a 36 px icon
 * button immediately left of the account menu.
 */
export function HelpMenu({ label, shortcutsLabel, onOpenShortcuts, links = [] }: HelpMenuProps): ReactElement {
  return (
    <Menu
      align="end"
      items={[...links, { id: SHORTCUTS, label: shortcutsLabel, icon: Keyboard, onSelect: onOpenShortcuts }]}
      trigger={<IconButton icon={CircleHelp} label={label} size="icon" iconSize="md" tooltipSide="bottom" />}
    />
  );
}
