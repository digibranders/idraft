'use client';

import { useTheme } from 'next-themes';
import { useSyncExternalStore, type ReactNode } from 'react';

import { SegmentedControl } from '@/components/ui/segmented-control';

type ThemeChoice = 'light' | 'dark' | 'system';
const CHOICES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: ThemeChoice; label: string }[];

const isChoice = (value: string | undefined): value is ThemeChoice =>
  value === 'light' || value === 'dark' || value === 'system';

// The stored choice is known in the browser only. Until hydration the control is left out, so the server
// and the first client render agree.
const subscribe = (): (() => void) => () => undefined;
const onClient = (): boolean => true;
const onServer = (): boolean => false;

/**
 * Switches the theme of the whole preview. One theme at a time, not two columns: a dialog, a menu or a
 * toast is portalled to `<body>` and takes the theme of the page, so a column could not show it in the
 * other theme, and the same section twice on one page would repeat every id.
 */
export function ThemeControl(): ReactNode {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribe, onClient, onServer);
  if (!hydrated) return null;
  return (
    <SegmentedControl
      semantics="view"
      size="sm"
      label="Theme"
      value={isChoice(theme) ? theme : 'system'}
      onValueChange={setTheme}
      items={CHOICES}
    />
  );
}
