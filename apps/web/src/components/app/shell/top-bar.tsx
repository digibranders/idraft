'use client';

import { Menu } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { IconButton } from '@/components/ui/icon-button';

export interface TopBarProps {
  breadcrumb: ReactNode;
  /** Right-aligned, in order: theme switch, help, account menu (11-navigation.md section 4). */
  controls: ReactNode;
  /**
   * The menu button below 1024 px, which opens the navigation drawer (focus returns to it on close);
   * `null` on a page without a sidebar, the workspace's project list.
   */
  navigation: { label: string; open: boolean; onOpen: () => void } | null;
}

/**
 * The 52 px bar above every project page (11-navigation.md section 4, 25 section 5.4): the breadcrumb on
 * the left, the controls on the right, 12 px apart. Search, the date range, the location and
 * notifications join it with the screens that need them.
 */
export function TopBar({ breadcrumb, controls, navigation }: TopBarProps): ReactElement {
  return (
    <header className="sticky top-0 z-(--z-sticky) flex h-topbar shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-3 sm:gap-3 md:px-4 lg:px-5">
      {navigation === null ? null : (
        <IconButton
          icon={Menu}
          label={navigation.label}
          size="icon"
          iconSize="md"
          tooltipSide="bottom"
          aria-expanded={navigation.open}
          aria-haspopup="dialog"
          onClick={navigation.onOpen}
          className="-ml-1 shrink-0 text-foreground-secondary lg:hidden"
        />
      )}
      {breadcrumb}
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">{controls}</div>
    </header>
  );
}
