import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';

/*
 * `next/navigation` for the tests of a part that reads the router and the address (a customizable screen's leave
 * guard). A test file turns it on with
 *   vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
 * `usePathname` answers from `navigateTo`, so a test can change the page and the component re-renders as it does
 * in the app. jsdom does not navigate, so the router's calls are only recorded.
 */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

const START = '/acme/overview';
let pathname = START;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = (): string => pathname;

/** The app moves to another page. */
export function navigateTo(next: string): void {
  pathname = next;
  listeners.forEach((listener) => {
    listener();
  });
}

/** Forgets the calls and goes back to the start page; call it before each test. */
export function resetNavigation(): void {
  Object.values(router).forEach((fn) => {
    fn.mockReset();
  });
  pathname = START;
}

export const navigationModule = {
  useRouter: () => router,
  usePathname: (): string => useSyncExternalStore(subscribe, read, read),
};
