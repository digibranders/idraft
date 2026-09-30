'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { linkedPath } from '@/lib/routes/paths';

export interface LeaveGuard {
  /** Where the person asked to go while the form had unsaved changes; the discard question is open. */
  pending: Route | null;
  /** "Keep editing": stay on the page. */
  stay: () => void;
  /** "Discard changes": go where they asked. */
  leave: () => void;
}

/** A click that would open another page of this app in this tab, and where to. */
function internalTarget(event: MouseEvent): Route | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null;
  }
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement) || (anchor.target !== '' && anchor.target !== '_self')) return null;
  if (anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href);
  if (url.origin !== window.location.origin) return null;
  const here = new URL(window.location.href);
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return linkedPath(url);
}

/** Offers a navigation to the guard on screen; `true` when a guard took it and asks first. */
type Intercept = (target: Route) => boolean;

/** Where the guard on screen, if any, registers for navigations that are not a click on a link. */
interface GuardRegistry {
  /** Makes `intercept` the guard on screen; the returned function removes it again. */
  register: (intercept: Intercept) => () => void;
  /** `true` when the guard on screen took the navigation. */
  offer: (target: Route) => boolean;
}

const LeaveGuardContext = createContext<GuardRegistry | null>(null);

function createRegistry(): GuardRegistry {
  let current: Intercept | null = null;
  return {
    register: (intercept) => {
      current = intercept;
      return () => {
        if (current === intercept) current = null;
      };
    },
    offer: (target) => current?.(target) ?? false,
  };
}

/**
 * Lets `useGuardedPush` reach the guard of a form below it. A workspace page has one, so a navigation from
 * the shell (the project switcher, the settings section select) asks before an unsaved form is left.
 */
export function LeaveGuardProvider({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const [registry] = useState(createRegistry);
  return <LeaveGuardContext value={registry}>{children}</LeaveGuardContext>;
}

/**
 * `router.push` for a navigation that is not a click on a link, such as choosing from a select: with a
 * form that has unsaved changes on screen, its discard question opens first.
 */
export function useGuardedPush(): (target: Route) => void {
  const router = useRouter();
  const registry = use(LeaveGuardContext);
  return useCallback(
    (target: Route): void => {
      if (registry?.offer(target) === true) return;
      router.push(target);
    },
    [registry, router],
  );
}

/**
 * Asks before a form with unsaved changes is left (10-forms.md section 13.2): a click on a link of the app
 * or a `useGuardedPush` navigation waits for the discard question, and closing or reloading the tab gets
 * the browser's own. The page's links need nothing: the guard listens on the document before the router
 * does. The browser's Back button is not caught: the App Router has no way to hold it.
 */
export function useLeaveGuard(dirty: boolean): LeaveGuard {
  const router = useRouter();
  const registry = use(LeaveGuardContext);
  const [pending, setPending] = useState<Route | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (!dirty) return undefined;
    // New unsaved changes after a discard that kept this page on screen are guarded again
    leaving.current = false;
    const intercept: Intercept = (target) => {
      if (leaving.current) return false;
      setPending(target);
      return true;
    };
    const unregister = registry?.register(intercept);
    const onClick = (event: MouseEvent): void => {
      if (leaving.current) return;
      const target = internalTarget(event);
      if (target === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(target);
    };
    const onUnload = (event: BeforeUnloadEvent): void => {
      if (!leaving.current) event.preventDefault();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unregister?.();
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [dirty, registry]);

  return {
    pending,
    stay: () => setPending(null),
    leave: () => {
      if (pending === null) return;
      leaving.current = true;
      setPending(null);
      router.push(pending);
    },
  };
}
