'use client';

/**
 * The ways out of customize mode that are not a button of the mode (docs/superpowers/plans/
 * 2026-11-13-ai-wp-16-layouts-customize.md, T7): a link or a guarded push, the browser's Back and Forward, and a
 * reload. With changes each one asks first, through the controller's discard dialog; without changes a
 * navigation ends the mode quietly. Links, guarded pushes and reloads are `useLeaveGuard`'s; Back and Forward
 * are held here, which the App Router cannot do.
 */
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';

/** Set in `history.state` of the entry the guard pushed, so it can tell that entry from every other. */
const MARK = 'idraftLayoutLeaveGuard';

function isGuardEntry(state: unknown): boolean {
  return typeof state === 'object' && state !== null && MARK in state;
}

// shortcut: one extra history entry while dirty; replace with the router's own blocker when Next.js has one
/**
 * One more entry for the address on screen, so the first Back lands on the page itself and not on the page
 * before it. The router's own state is copied: its popstate handler ignores an entry it did not make.
 */
function pushGuardEntry(): void {
  const state: unknown = window.history.state;
  window.history.pushState({ ...(typeof state === 'object' ? state : null), [MARK]: true }, '', window.location.href);
}

export interface LayoutLeaveGuardOptions {
  customizing: boolean;
  /** The draft differs from the saved layout. */
  dirty: boolean;
  /** A save is under way: nothing is asked and nothing is left until it is answered. */
  saving: boolean;
  /** Ends customize mode and drops the draft. It must be the same function on every render. */
  exit: () => void;
}

export interface LayoutLeaveGuard {
  /** The discard question is to be on screen: a link, a push or Back was held. */
  asking: boolean;
  /** "Keep editing": the person stays, and the address is the one they left from. */
  stay: () => void;
  /** "Discard changes": ends the mode, then goes where the person asked. */
  leave: () => void;
}

export function useLayoutLeaveGuard({ customizing, dirty, saving, exit }: LayoutLeaveGuardOptions): LayoutLeaveGuard {
  const router = useRouter();
  const pathname = usePathname();
  const link = useLeaveGuard(dirty);
  const [pressedBack, setPressedBack] = useState(false);

  // What the listeners below read: the state of the last render
  const live = useRef({ customizing, dirty });
  useEffect(() => {
    live.current = { customizing, dirty };
  });
  // `history.back()` was sent to drop the entry and its `popstate` has not arrived
  const dropping = useRef(false);
  // The person is going somewhere: the entry goes with that move, so nothing drops it or asks again
  const leaving = useRef(false);

  const wasDirty = useRef(false);
  useEffect(() => {
    if (dirty === wasDirty.current) return;
    wasDirty.current = dirty;
    if (dirty) {
      leaving.current = false;
      // A drop under way is answered by its `popstate`, which pushes the entry again
      if (!dropping.current) pushGuardEntry();
    } else if (!leaving.current && isGuardEntry(window.history.state)) {
      // Saved or cancelled: the entry is only dropped while it is still the top one
      dropping.current = true;
      window.history.back();
    }
  }, [dirty]);

  useEffect(() => {
    const onPopState = (): void => {
      if (dropping.current) {
        dropping.current = false;
        if (live.current.dirty) pushGuardEntry();
        return;
      }
      // The guard entry itself became current again (Back from an entry above it): nothing is left
      if (leaving.current || !live.current.dirty || isGuardEntry(window.history.state)) return;
      // Back or Forward reached an earlier entry: the one that was used up is pushed again and the question asked
      pushGuardEntry();
      setPressedBack(true);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // A navigation without changes ends the mode. A search only change is not one: the filter bar stays usable
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (live.current.customizing && !live.current.dirty) exit();
  }, [pathname, exit]);

  // The question goes with the changes, and is not asked while a save has the draft
  const asking = pressedBack || link.pending !== null;
  if (asking && (!dirty || saving)) {
    setPressedBack(false);
    link.stay();
  }

  const stay = (): void => {
    setPressedBack(false);
    link.stay();
  };
  const leave = (): void => {
    if (pressedBack) {
      leaving.current = true;
      stay();
      exit();
      // Past the entry that was pushed again, to the page before this one
      window.history.go(-2);
      return;
    }
    const target: Route | null = link.pending;
    if (target === null) return;
    leaving.current = true;
    // The guard entry takes the place of the page asked for, so Back from there goes one page back
    const own = isGuardEntry(window.history.state);
    stay();
    exit();
    if (own) router.replace(target);
    else router.push(target);
  };
  return { asking: asking && dirty && !saving, stay, leave };
}
