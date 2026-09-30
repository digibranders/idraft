'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

import { useShortcut } from '@/lib/a11y/use-shortcut';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import { sidebarCookie, type SidebarPreference } from '@/lib/navigation/sidebar-state';

export interface SidebarState {
  /** Whether the 56 px rail is showing (1024 to 1279 px unless expanded over the page; 1280 px and up when collapsed). */
  rail: boolean;
  /** The Collapse or Expand button, and the `[` key. */
  toggle: () => void;
  /** Closes the rail's expanded overlay, after a destination was followed. */
  closePeek: () => void;
}

/**
 * The sidebar's modes (19-responsive-behavior.md section 3.1, 11-navigation.md section 3). At 1280 px and
 * up the toggle collapses it to the rail and the choice is kept in a cookie, so the server renders it
 * (`<html data-sidebar>`). At 1024 to 1279 px the rail is the rule, and the toggle expands it over the page
 * (`data-sidebar-peek`) until a destination is followed, Escape is pressed or the page is clicked. Below
 * 1024 px the sidebar is the drawer, which has no toggle.
 *
 * `[` toggles it (a single-key shortcut, `useShortcut`; the switch that turns single-key shortcuts off
 * arrives with Settings > Preferences).
 */
export function useSidebar(initial: SidebarPreference, sidebarRef: RefObject<HTMLElement | null>): SidebarState {
  const wide = useMediaQuery(MEDIA.xl);
  const railRange = useMediaQuery(MEDIA.rail);
  const [preference, setPreference] = useState(initial);
  const [peek, setPeek] = useState(false);
  // The expanded overlay only exists at 1024 to 1279 px, and is gone after the window leaves that range
  const [wasRailRange, setWasRailRange] = useState(railRange);
  if (wasRailRange !== railRange) {
    setWasRailRange(railRange);
    if (!railRange) setPeek(false);
  }
  const peeking = peek && railRange;

  useEffect(() => {
    document.documentElement.toggleAttribute('data-sidebar-peek', peeking);
  }, [peeking]);
  useEffect(() => () => document.documentElement.removeAttribute('data-sidebar-peek'), []);

  const toggle = useCallback((): void => {
    if (wide) {
      // From the page, not from state: another tab may have changed the choice (and the cookie) meanwhile
      const next = document.documentElement.dataset.sidebar === 'collapsed' ? 'expanded' : 'collapsed';
      setPreference(next);
      document.documentElement.dataset.sidebar = next;
      document.cookie = sidebarCookie(next);
    } else if (railRange) {
      setPeek((open) => !open);
    }
  }, [wide, railRange]);
  const closePeek = useCallback((): void => setPeek(false), []);

  useShortcut('[', toggle, { kind: 'single-key' });
  // Escape closes the expanded rail and returns focus to its toggle, as the preview does
  useShortcut(
    'Escape',
    () => {
      setPeek(false);
      sidebarRef.current?.querySelector<HTMLButtonElement>('button[aria-keyshortcuts]')?.focus();
    },
    { kind: 'dismiss', enabled: peeking },
  );

  // A press anywhere else on the page closes it too
  useEffect(() => {
    if (!peeking) return undefined;
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !sidebarRef.current?.contains(event.target)) setPeek(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [peeking, sidebarRef]);

  const rail = wide ? preference === 'collapsed' : railRange && !peeking;
  return { rail, toggle, closePeek };
}
