'use client';

import { useEffect, type ReactNode } from 'react';

import { SingleKeyShortcutsContext } from '@/components/ui/kbd';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import { usePreferences } from '@/lib/preferences/preferences';
import { useMe } from '@/lib/session/use-me';

/**
 * Puts the person's preferences into effect on every page of the workspace: reduced motion as
 * `<html data-motion="reduced">`, which tokens.css turns into zero durations, and single-key shortcuts,
 * for the shortcuts and for the key hints that show them.
 */
export function ApplyPreferences({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const { user } = useMe();
  const [preferences] = usePreferences(user.user_id);
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.reduceMotion) root.dataset.motion = 'reduced';
    else delete root.dataset.motion;
    return () => {
      delete root.dataset.motion;
    };
  }, [preferences.reduceMotion]);
  return (
    <SingleKeysContext value={preferences.singleKeys}>
      <SingleKeyShortcutsContext value={preferences.singleKeys}>{children}</SingleKeyShortcutsContext>
    </SingleKeysContext>
  );
}
