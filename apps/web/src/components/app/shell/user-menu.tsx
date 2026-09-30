'use client';

import { LogOut, UserRound } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface UserMenuLabels {
  /** "Account menu, Ana Brandt": the button's name. */
  trigger: string;
  /** "Account": its tooltip. */
  tooltip: string;
  theme: string;
  system: string;
  light: string;
  dark: string;
  accountSettings: string;
  signOut: string;
}

export interface UserMenuProps {
  user: { name: string; email: string; imageUrl: string | null };
  /**
   * The theme group, below 1440 px only, where the top bar has no theme switch (11-navigation.md section
   * 4); `null` from 1440 px, so the theme control never appears twice.
   */
  theme: { value: ThemeChoice; onValueChange: (value: ThemeChoice) => void } | null;
  /** Settings > Profile; `null` where no project is open. */
  accountSettings: ReactElement | null;
  onSignOut: () => void;
  labels: UserMenuLabels;
}

/**
 * The account menu (11-navigation.md section 4, 25 section 5.8): a 32 px avatar that opens the name and
 * email, the theme below 1440 px, Account settings and Sign out. Personal preferences are in Settings >
 * Preferences, not here.
 */
export function UserMenu({ user, theme, accountSettings, onSignOut, labels }: UserMenuProps): ReactElement {
  const themeItems: MenuItemDef[] =
    theme === null
      ? []
      : (['system', 'light', 'dark'] as const).map((value) => ({
          id: value,
          label: labels[value],
          kind: 'radio',
          group: labels.theme,
          checked: theme.value === value,
          onSelect: () => theme.onValueChange(value),
        }));
  const items: MenuItemDef[] = [
    ...themeItems,
    ...(accountSettings === null
      ? []
      : [
          {
            id: 'account',
            label: labels.accountSettings,
            icon: UserRound,
            kind: 'link' as const,
            link: accountSettings,
          },
        ]),
    { id: 'sign-out', label: labels.signOut, icon: LogOut, onSelect: onSignOut },
  ];
  return (
    <Menu
      align="end"
      items={items}
      header={
        <>
          <p className="truncate type-body-strong">{user.name}</p>
          <p className="truncate type-meta">{user.email}</p>
        </>
      }
      trigger={
        <UserMenuTrigger name={user.name} imageUrl={user.imageUrl} label={labels.trigger} tooltip={labels.tooltip} />
      }
    />
  );
}

interface TriggerProps {
  name: string;
  imageUrl: string | null;
  label: string;
  tooltip: string;
}

/** The avatar button. It passes the menu's props and ref on to the button, as a menu trigger must. */
function UserMenuTrigger({
  name,
  imageUrl,
  label,
  tooltip,
  ...props
}: TriggerProps & Omit<ComponentProps<'button'>, 'children' | 'className'>): ReactElement {
  return (
    <Tooltip content={tooltip} side="bottom">
      <button
        type="button"
        aria-label={label}
        // Where a theme chosen in this menu is revealed from
        data-theme-origin=""
        {...props}
        className="flex size-avatar shrink-0 items-center justify-center rounded-full hover:ring-2 hover:ring-border focus-visible:focus-ring"
      >
        <Avatar name={name} imageUrl={imageUrl} />
      </button>
    </Tooltip>
  );
}
