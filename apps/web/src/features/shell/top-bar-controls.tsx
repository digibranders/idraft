'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { useThemeChange } from './use-theme-change';
import { HelpMenu } from '@/components/app/shell/help-menu';
import { KeyboardShortcutsDialog, type ShortcutEntry } from '@/components/app/shell/keyboard-shortcuts-dialog';
import { ThemeSwitch } from '@/components/app/shell/theme-switch';
import { UserMenu, type ThemeChoice } from '@/components/app/shell/user-menu';
import { toast } from '@/components/ui/toast';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import { useSignOut } from '@/lib/session/sign-out';
import { useMe } from '@/lib/session/use-me';

const SHORTCUTS_SHORTCUT = 'shortcuts';

export interface TopBarControlsProps {
  /** Settings > Profile of the open project, or `null` where no project is open. */
  accountSettings: ReactElement | null;
  /** The shortcuts of the page besides `?`, for the shortcuts dialog. */
  shortcuts: readonly ShortcutEntry[];
}

/**
 * The right side of the top bar (11-navigation.md section 4): the theme switch from 1440 px, Help, and the
 * account menu (with the theme below 1440 px, Account settings and Sign out), and the keyboard shortcuts
 * dialog that Help and `?` open.
 */
export function TopBarControls({ accountSettings, shortcuts }: TopBarControlsProps): ReactNode {
  const t = useTranslations('shell');
  const common = useTranslations('common');
  const { user } = useMe();
  const theme = useThemeChange();
  const wide = useMediaQuery(MEDIA['2xl']);
  const { signOut } = useSignOut();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcut('?', () => setShortcutsOpen(true), { kind: 'single-key' });

  // From the account menu the new theme grows from the account button, once the menu has closed (21 section 5.1)
  const changeFromMenu = (value: ThemeChoice): void => {
    requestAnimationFrame(() => {
      const box = document.querySelector('[data-theme-origin]')?.getBoundingClientRect();
      theme.change(value, box === undefined ? undefined : { x: box.left + box.width / 2, y: box.top + box.height / 2 });
    });
  };
  const leave = (): void => {
    signOut().catch(() => toast({ type: 'error', title: t('user.signOutFailed') }));
  };

  return (
    <>
      <ThemeSwitch
        resolvedTheme={theme.resolved}
        onToggle={(next, origin) => theme.change(next, origin)}
        label={t('theme.switch')}
        tooltip={t('theme.tooltip')}
      />
      <HelpMenu
        label={t('help.label')}
        shortcutsLabel={t('help.shortcuts')}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <UserMenu
        user={{ name: user.name, email: user.email, imageUrl: user.image }}
        theme={wide ? null : { value: theme.choice, onValueChange: changeFromMenu }}
        accountSettings={accountSettings}
        onSignOut={leave}
        labels={{
          trigger: t('user.trigger', { name: user.name }),
          tooltip: t('user.tooltip'),
          theme: t('theme.group'),
          system: t('theme.system'),
          light: t('theme.light'),
          dark: t('theme.dark'),
          accountSettings: t('user.accountSettings'),
          signOut: t('user.signOut'),
        }}
      />
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        title={t('shortcuts.title')}
        description={t('shortcuts.description')}
        closeLabel={common('close')}
        shortcuts={[...shortcuts, { id: SHORTCUTS_SHORTCUT, label: t('shortcuts.open'), keys: ['?'] }]}
      />
    </>
  );
}
