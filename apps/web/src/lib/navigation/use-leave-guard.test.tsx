import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeaveGuardProvider, useGuardedPush, useLeaveGuard } from './use-leave-guard';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const SECURITY = '/digibranders/fynix/settings/security' as Route;

function Links(): ReactNode {
  return (
    <>
      <a href={SECURITY}>Security</a>
      <a href="https://example.com/help">Elsewhere</a>
      <a href={SECURITY} target="_blank" rel="noreferrer">
        New tab
      </a>
      <a href="/report.csv" download>
        Download
      </a>
    </>
  );
}

/** A click as the browser sends it; `true` when nothing stopped the default navigation. */
const click = (name: string, init: MouseEventInit = {}): boolean =>
  fireEvent.click(screen.getByRole('link', { name }), { button: 0, ...init });

describe('useLeaveGuard', () => {
  beforeEach(() => router.push.mockReset());

  it('holds a click on a link of the app while there are unsaved changes, and goes on Leave', () => {
    render(<Links />);
    const { result } = renderHook(() => useLeaveGuard(true));
    expect(click('Security')).toBe(false);
    expect(result.current.pending).toBe(SECURITY);
    act(() => result.current.leave());
    expect(router.push).toHaveBeenCalledWith(SECURITY);
    expect(result.current.pending).toBeNull();
  });

  it('stays on Keep editing', () => {
    render(<Links />);
    const { result } = renderHook(() => useLeaveGuard(true));
    click('Security');
    act(() => result.current.stay());
    expect(result.current.pending).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('lets through what does not leave the page in this tab, and everything once the form is saved', () => {
    render(<Links />);
    const { result, rerender } = renderHook(({ dirty }) => useLeaveGuard(dirty), { initialProps: { dirty: true } });
    const quiet = (event: Event): void => event.preventDefault();
    // jsdom would try to navigate on an anchor's default action
    document.addEventListener('click', quiet);
    click('Elsewhere');
    click('New tab');
    click('Download');
    click('Security', { metaKey: true });
    expect(result.current.pending).toBeNull();
    rerender({ dirty: false });
    click('Security');
    expect(result.current.pending).toBeNull();
    document.removeEventListener('click', quiet);
  });

  it('asks the browser before the tab is closed or reloaded with unsaved changes', () => {
    const { rerender } = renderHook(({ dirty }) => useLeaveGuard(dirty), { initialProps: { dirty: true } });
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    rerender({ dirty: false });
    const later = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });
});

describe('useGuardedPush', () => {
  beforeEach(() => router.push.mockReset());

  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <LeaveGuardProvider>{children}</LeaveGuardProvider>
  );

  it('navigates at once when no form on screen has unsaved changes', () => {
    const { result } = renderHook(() => useGuardedPush(), { wrapper });
    result.current(SECURITY);
    expect(router.push).toHaveBeenCalledWith(SECURITY);
  });

  it('opens the question of a form with unsaved changes first', () => {
    const { result } = renderHook(({ dirty }) => ({ guard: useLeaveGuard(dirty), push: useGuardedPush() }), {
      wrapper,
      initialProps: { dirty: true },
    });
    act(() => result.current.push(SECURITY));
    expect(router.push).not.toHaveBeenCalled();
    expect(result.current.guard.pending).toBe(SECURITY);
    act(() => result.current.guard.leave());
    expect(router.push).toHaveBeenCalledWith(SECURITY);
  });

  it('works without a provider, as a plain push', () => {
    const { result } = renderHook(() => useGuardedPush());
    result.current(SECURITY);
    expect(router.push).toHaveBeenCalledWith(SECURITY);
  });
});
