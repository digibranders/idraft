'use client';

import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import type { ThemeChoice } from '@/components/app/shell/user-menu';

export interface ThemeChange {
  /** What the person chose: System, Light or Dark. */
  choice: ThemeChoice;
  /**
   * What is on screen; `null` until the page has hydrated. The server does not know the theme (it is in the
   * browser's storage), so a control that shows it waits, instead of rendering a state React would keep.
   */
  resolved: 'light' | 'dark' | null;
  /** Changes the theme; with `origin`, the new one is revealed as a circle growing from there. */
  change: (next: ThemeChoice, origin?: { x: number; y: number }) => void;
}

/** A motion token of tokens.css: `--duration-reveal` is 0 under reduced motion. */
const tokenOf = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
const durationOf = (name: string): number => Number.parseFloat(tokenOf(`duration-${name}`)) || 0;

const noSubscription = (): (() => void) => () => undefined;

const isChoice = (value: string | undefined): value is ThemeChoice =>
  value === 'system' || value === 'light' || value === 'dark';

/**
 * The theme through next-themes, with the reveal of 21-motion.md section 5.1: the new theme grows as a
 * circle from the control that asked for it, through the View Transitions API. Without that API, under
 * reduced motion, or when nothing changes on screen, the theme swaps at once.
 */
export function useThemeChange(): ThemeChange {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const choice: ThemeChoice = isChoice(theme) ? theme : 'system';
  const resolved = hydrated ? (resolvedTheme === 'dark' ? 'dark' : 'light') : null;

  const change = (next: ThemeChoice, origin?: { x: number; y: number }): void => {
    const root = document.documentElement;
    const nextDark =
      next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const reveal = durationOf('reveal');
    if (
      origin === undefined ||
      reveal === 0 ||
      nextDark === (resolved === 'dark') ||
      typeof document.startViewTransition !== 'function'
    ) {
      setTheme(next);
      return;
    }
    const transition = document.startViewTransition(() => {
      // The view transition captures the page when this returns, so the class changes now, not in an effect
      root.classList.toggle('dark', nextDark);
      flushSync(() => setTheme(next));
    });
    const radius = Math.hypot(
      Math.max(origin.x, window.innerWidth - origin.x),
      Math.max(origin.y, window.innerHeight - origin.y),
    );
    transition.ready
      .then(() =>
        root.animate(
          {
            clipPath: [
              `circle(0px at ${String(origin.x)}px ${String(origin.y)}px)`,
              `circle(${String(radius)}px at ${String(origin.x)}px ${String(origin.y)}px)`,
            ],
          },
          { duration: reveal, easing: tokenOf('ease-standard'), pseudoElement: '::view-transition-new(root)' },
        ),
      )
      // A transition the browser skips has already applied the theme
      .catch(() => undefined);
  };

  return { choice, resolved, change };
}
