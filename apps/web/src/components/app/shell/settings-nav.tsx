'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useId, type ReactElement } from 'react';

import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface SettingsNavItem {
  id: string;
  label: string;
  href: Route;
}
export interface SettingsNavGroup {
  label: string;
  items: readonly SettingsNavItem[];
}

export interface SettingsNavProps {
  /** "Settings sections": the landmark's name. */
  label: string;
  groups: readonly SettingsNavGroup[];
  /** The id of the section on screen. */
  current: string;
  /** Below 1024 px the navigation is a select; choosing opens the section. */
  onSelect: (item: SettingsNavItem) => void;
  /** "Section": the select's label. */
  selectLabel: string;
}

const ITEM = cn(
  'flex h-sidebar-item items-center rounded-md px-2 type-body text-foreground-secondary hover:bg-surface-hover focus-visible:focus-ring',
);
const CURRENT = cn('bg-surface-selected type-body-strong text-primary-text hover:bg-surface-selected');

/**
 * The local navigation of Settings (11-navigation.md section 5, 25 section `SettingsNav`): a 200 px list with
 * the sidebar's item styling, sticky under the top bar, in groups (Your account, Project settings,
 * Workspace settings). Below 1024 px it is a `Select` above the form. It sticks at the top bar's height,
 * with the page's 20 px gap above its first item kept as padding. Scrolling inside itself on a short
 * window waits for the groups of the later settings plans: "Your account" has three items.
 */
export function SettingsNav({ label, groups, current, onSelect, selectLabel }: SettingsNavProps): ReactElement {
  const selectId = useId();
  const items = groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
  return (
    <>
      <nav aria-label={label} className="sticky top-topbar -mt-5 hidden w-50 shrink-0 flex-col gap-1 pt-5 lg:flex">
        {groups.map((group, index) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className={cn('px-2 pb-1 type-label', index > 0 && 'pt-4')}>{group.label}</p>
            {group.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                aria-current={item.id === current ? 'page' : undefined}
                className={cn(ITEM, item.id === current && CURRENT)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex max-w-90 flex-col gap-1.5 lg:hidden">
        <label htmlFor={selectId} className="type-label">
          {selectLabel}
        </label>
        <Select
          id={selectId}
          value={current}
          placeholder={selectLabel}
          options={items.map((item) => ({ value: item.id, label: item.label, group: item.group }))}
          onValueChange={(id) => {
            const item = items.find((candidate) => candidate.id === id);
            if (item) onSelect(item);
          }}
        />
      </div>
    </>
  );
}
