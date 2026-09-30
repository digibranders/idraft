'use client';

import { useSyncExternalStore } from 'react';

const noSubscription = (): (() => void) => () => undefined;

/**
 * `false` on the server and during hydration, `true` after. A control that shows what only the browser
 * knows (the theme in its storage) renders its server state until then, instead of a state React would
 * keep from the server's HTML.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
