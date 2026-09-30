'use client';

import { useTheme } from 'next-themes';
import type { ReactNode } from 'react';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { useHydrated } from '@/lib/dom/use-hydrated';
import { isThemeChoice, type ThemeChoice } from '@/lib/preferences/theme';

const CHOICES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: ThemeChoice; label: string }[];

/**
 * Switches the theme of the whole preview. One theme at a time, not two columns: a dialog, a menu or a
 * toast is portalled to `<body>` and takes the theme of the page, so a column could not show it in the
 * other theme, and the same section twice on one page would repeat every id.
 */
export function ThemeControl(): ReactNode {
  const { theme, setTheme } = useTheme();
  // The stored choice is known in the browser only. Until hydration the control is left out, so the server
  // and the first client render agree.
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return (
    <SegmentedControl
      semantics="view"
      size="sm"
      label="Theme"
      value={isThemeChoice(theme) ? theme : 'system'}
      onValueChange={setTheme}
      items={CHOICES}
    />
  );
}
