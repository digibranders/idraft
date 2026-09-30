'use client';

import { ChevronsLeft, X, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface SidebarItemProps {
  id: string;
  href: Route;
  label: string;
  /** The full name in the rail's tooltip: "SEO: Rankings". */
  fullLabel: string;
  icon: LucideIcon;
  current: boolean;
}
export interface SidebarGroupProps {
  /** Text, never a link; `null` for items outside the labelled groups. */
  label: string | null;
  items: readonly SidebarItemProps[];
}
export interface SidebarSectionProps {
  id: number;
  groups: readonly SidebarGroupProps[];
}

export interface SidebarNavProps {
  /** `page`: in the layout, expanded or the rail by the breakpoint variants. `drawer`: inside the drawer. */
  mode: 'page' | 'drawer';
  /** Whether the rail is showing, for the tooltips and the toggle's words. */
  rail: boolean;
  sections: readonly SidebarSectionProps[];
  /** The project switcher at the top. */
  projectSwitcher: ReactNode;
  /** The Collapse or Expand button; `controls` is the id of the sidebar it changes. */
  toggle: { label: string; visibleLabel: string; onToggle: () => void; controls: string } | null;
  /** The drawer's Close button. */
  close: { label: string; onClose: () => void } | null;
  /** Called when an item is followed, so a drawer or an expanded rail can close. */
  onNavigate?: (() => void) | undefined;
}

const ITEM = cn(
  'flex h-sidebar-item items-center gap-3 rounded-md px-2 type-body text-foreground-secondary hover:bg-surface-hover focus-visible:focus-ring rail:justify-center',
);
const CURRENT = cn('bg-surface-selected type-body-strong text-primary-text hover:bg-surface-selected');

/**
 * The contents of the primary navigation (11-navigation.md sections 1 to 3, 25 section 5.3): the project
 * switcher, the destinations in their sections and groups, and the collapse toggle. The same markup is
 * the expanded sidebar and the 56 px rail, by the `rail:` variants of globals.css, and the drawer below
 * 1024 px. Groups are separated by 16 px of space, never by lines.
 */
export function SidebarNav({
  mode,
  rail,
  sections,
  projectSwitcher,
  toggle,
  close,
  onNavigate,
}: SidebarNavProps): ReactElement {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="mx-2 mt-3 flex items-center gap-1">
        <div className="min-w-0 flex-1">{projectSwitcher}</div>
        {close === null ? null : <IconButton icon={X} label={close.label} size="icon" onClick={close.onClose} />}
      </div>
      <div className="mt-4 flex flex-col gap-1 overflow-y-auto px-2">
        {sections.map((section, sectionIndex) => (
          // 24 px between sections: the 4 px gap of the column and 20 px here, as the preview's spacer gives
          <div key={section.id} className={cn('flex flex-col gap-1', sectionIndex > 0 && 'pt-5')}>
            {section.groups.map((group, groupIndex) => (
              <div
                key={group.label ?? `section-${String(section.id)}-${String(groupIndex)}`}
                className="flex flex-col gap-1"
              >
                {group.label === null ? null : (
                  <>
                    <div className="block px-2 pt-4 pb-1 type-label rail:hidden">{group.label}</div>
                    {/* The rail keeps the group's 16 px of space without its label */}
                    <div aria-hidden="true" className="hidden h-4 rail:block" />
                  </>
                )}
                {group.items.map((item) => (
                  <SidebarItem key={item.id} item={item} rail={rail && mode === 'page'} onNavigate={onNavigate} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {toggle === null ? null : (
        <div className="mt-auto flex flex-col gap-2 px-2 pt-4 pb-4">
          <Tooltip content={toggle.label} side="right" purpose="label" shortcut={['[']} disabled={!rail}>
            <Button
              variant="ghost"
              aria-label={toggle.label}
              aria-expanded={!rail}
              aria-controls={toggle.controls}
              aria-keyshortcuts="["
              onClick={toggle.onToggle}
              className="h-sidebar-item justify-start gap-3 px-2 type-body text-foreground-secondary rail:justify-center"
            >
              <Icon icon={ChevronsLeft} size="md" className="shrink-0 text-foreground-tertiary rail:rotate-180" />
              <span className="truncate rail:sr-only">{toggle.visibleLabel}</span>
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

function SidebarItem({
  item,
  rail,
  onNavigate,
}: {
  item: SidebarItemProps;
  rail: boolean;
  onNavigate: (() => void) | undefined;
}): ReactElement {
  return (
    // In the rail the label is visually hidden, so the tooltip shows it; it is the link's own name, said once
    <Tooltip content={item.fullLabel} side="right" purpose="label" disabled={!rail}>
      <Link
        href={item.href}
        aria-current={item.current ? 'page' : undefined}
        className={cn(ITEM, item.current && CURRENT)}
        {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      >
        <Icon
          icon={item.icon}
          size="md"
          className={cn('shrink-0', item.current ? 'text-primary-text' : 'text-foreground-tertiary')}
        />
        <span className="truncate rail:sr-only">{item.label}</span>
      </Link>
    </Tooltip>
  );
}
