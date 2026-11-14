import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  ScreenUnderTest,
  box,
  firstHandle,
  serveLayouts,
  startCustomizing,
  stateOf,
  stubViewport,
} from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { navigateTo, resetNavigation, router } from '@/test/next-navigation';
import { LeaveGuardProvider, useGuardedPush } from '@/lib/navigation/use-leave-guard';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

/*
 * Leaving customize mode with changes by a link, Back, Forward or a reload (docs/superpowers/plans/
 * 2026-11-13-ai-wp-16-layouts-customize.md, T7). jsdom has no real history navigation: the browser's Back is
 * modelled here by what it does, which is to make an earlier entry current and then fire `popstate`. The real
 * behaviour is checked in Chromium.
 */
const DISCARD_TITLE = 'Discard unsaved changes?';
const SETTINGS = '/acme/settings' as Route;

let pushState: MockInstance<History['pushState']>;
let back: MockInstance<History['back']>;
let go: MockInstance<History['go']>;

beforeEach(() => {
  resetNavigation();
  serveLayouts();
  stubViewport();
  window.history.replaceState(null, '', '/');
  pushState = vi.spyOn(window.history, 'pushState');
  // The browser would move; here only the call is seen
  back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
});
afterEach(() => {
  pushState.mockRestore();
  back.mockRestore();
  go.mockRestore();
  vi.unstubAllGlobals();
});

function PushButton(): ReactElement {
  const push = useGuardedPush();
  return (
    <button
      type="button"
      onClick={() => {
        push(SETTINGS);
      }}
    >
      Push
    </button>
  );
}

function renderScreen(): ProvidedRender {
  return renderWithProviders(
    <LeaveGuardProvider>
      <ScreenUnderTest
        extra={
          <>
            <a href={SETTINGS}>Settings</a>
            <PushButton />
          </>
        }
      />
    </LeaveGuardProvider>,
  );
}

const discardDialog = (): HTMLElement | null => screen.queryByRole('alertdialog', { name: DISCARD_TITLE });
const inScreen = (name: string): HTMLElement => within(box()).getByRole('button', { name });

/** Customize mode on screen with one change made. */
async function dirty(): Promise<ProvidedRender> {
  const view = renderScreen();
  await startCustomizing(view.user);
  await view.user.click(inScreen('Edit'));
  await waitFor(() => {
    expect(stateOf()).toBe('customize 1');
  });
  return view;
}

/** The browser's Back (or Forward) to an entry that is not the one the guard pushed: the entry becomes current, then `popstate`. */
function browserMovesToAnotherEntry(): void {
  window.history.replaceState({ entry: 'page' }, '');
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: { entry: 'page' } }));
  });
}

/**
 * A click on the link as the browser sends it; `true` when the guard held it (the default action was already
 * prevented by the time the page's own listeners ran). jsdom must not try to navigate when the guard lets it through.
 */
function guardHeldClickOn(name: string): boolean {
  let held = false;
  const observe = (event: Event): void => {
    held = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', observe);
  fireEvent.click(screen.getByRole('link', { name }), { button: 0 });
  document.removeEventListener('click', observe);
  return held;
}

const waitForDialog = (): Promise<HTMLElement> => screen.findByRole('alertdialog', { name: DISCARD_TITLE });

describe('the history entry', () => {
  it('is pushed once for the same address when the first change is made, and marked', async () => {
    const { user } = renderScreen();
    await startCustomizing(user);
    expect(pushState).not.toHaveBeenCalled();
    await user.click(inScreen('Edit'));
    await waitFor(() => {
      expect(pushState).toHaveBeenCalledTimes(1);
    });
    expect(pushState.mock.calls[0]?.[2]).toBe(window.location.href);
    expect(window.history.state).toMatchObject({ idraftLayoutLeaveGuard: true });
  });

  it('is dropped once when the changes are saved', async () => {
    const { user } = await dirty();
    await user.click(inScreen('Save now'));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('is dropped once when the changes are discarded with Cancel', async () => {
    const { user } = await dirty();
    await user.click(inScreen('Leave'));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('is left alone when it is no longer the top entry', async () => {
    const { user } = await dirty();
    // Something else pushed an entry above it (a filter that keeps its history)
    window.history.pushState({ entry: 'filtered' }, '');
    await user.click(inScreen('Leave'));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(back).not.toHaveBeenCalled();
  });

  /*
   * Anything that calls `replaceState` rewrites the state of the guard entry and the marker goes with it: the
   * router's own (it keeps only its two fields), a filter that writes the address (nuqs passes null), a
   * `router.replace` of the search and `router.refresh()`. The entry is still the top one.
   */
  describe.each([
    ['a state of null (nuqs)', null, '/?q=1'],
    ['the router state only (router.refresh)', { __NA: true }, '/'],
    ['the router state and a new search (router.replace)', { __NA: true }, '/?f=1'],
  ])('after a replaceState with %s', (_name, state, url) => {
    const replaced = async (): Promise<ProvidedRender> => {
      const view = await dirty();
      window.history.replaceState(state, '', url);
      return view;
    };

    it('Save still drops the entry once', async () => {
      const { user } = await replaced();
      await user.click(inScreen('Save now'));
      await waitFor(() => {
        expect(stateOf()).toBe('view 0');
      });
      expect(back).toHaveBeenCalledTimes(1);
    });

    it('Cancel still drops the entry once', async () => {
      const { user } = await replaced();
      await user.click(inScreen('Leave'));
      await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
      await waitFor(() => {
        expect(stateOf()).toBe('view 0');
      });
      expect(back).toHaveBeenCalledTimes(1);
    });

    it('Discard after a link still replaces the entry with the link', async () => {
      const { user } = await replaced();
      await user.click(screen.getByRole('link', { name: 'Settings' }));
      await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
      await waitFor(() => {
        expect(stateOf()).toBe('view 0');
      });
      expect(router.replace).toHaveBeenCalledExactlyOnceWith(SETTINGS);
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  it('a link Discard pushes when something else pushed an entry above the guard entry', async () => {
    const { user } = await dirty();
    window.history.pushState({ entry: 'filtered' }, '');
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(router.push).toHaveBeenCalledExactlyOnceWith(SETTINGS);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('is dropped when the browser lands on the guard entry again and the changes are then saved', async () => {
    const { user } = await dirty();
    window.history.pushState({ entry: 'filtered' }, '');
    // Back from the filtered entry: the guard entry (its state rewritten meanwhile) is current again
    window.history.replaceState({ idraftLayoutLeaveGuard: true }, '');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { idraftLayoutLeaveGuard: true } }));
    });
    await user.click(inScreen('Save now'));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('is pushed again after the browser has finished dropping it, when a change is made in between', async () => {
    const { user } = await dirty();
    inScreen('Edit').focus();
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => {
      expect(back).toHaveBeenCalledTimes(1);
    });
    await user.keyboard('{Shift>}{Control>}z{/Control}{/Shift}');
    await waitFor(() => {
      expect(stateOf()).toBe('customize 1');
    });
    // The drop is still on its way: pushing now would be taken back by it
    expect(pushState).toHaveBeenCalledTimes(1);
    browserMovesToAnotherEntry();
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(discardDialog()).toBeNull();
    expect(window.history.state).toMatchObject({ idraftLayoutLeaveGuard: true });
  });
});

describe('a link or a guarded push', () => {
  it('a click on an app link while dirty opens the discard dialog and does not navigate', async () => {
    const { user } = await dirty();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await waitForDialog()).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    expect(stateOf()).toBe('customize 1');
  });

  it('Keep editing leaves the address as it was, the draft in place and focus on the first handle', async () => {
    const { user } = await dirty();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });
    expect(window.location.pathname).toBe('/');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(stateOf()).toBe('customize 1');
    await waitFor(() => {
      expect(firstHandle()).toHaveFocus();
    });
  });

  it('Discard exits and replaces the extra entry with the link, so Back goes one page back', async () => {
    const { user } = await dirty();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(router.replace).toHaveBeenCalledExactlyOnceWith(SETTINGS);
    expect(router.push).not.toHaveBeenCalled();
    // The replace takes the extra entry's place: dropping it as well would go back a page too far
    expect(back).not.toHaveBeenCalled();
  });

  it('a useGuardedPush navigation asks first', async () => {
    const { user } = await dirty();
    await user.click(inScreen('Push'));
    expect(await waitForDialog()).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(router.replace).toHaveBeenCalledExactlyOnceWith(SETTINGS);
  });

  it('does not hold a link while there are no changes', async () => {
    const { user } = renderScreen();
    await startCustomizing(user);
    expect(guardHeldClickOn('Settings')).toBe(false);
    expect(discardDialog()).toBeNull();
  });
});

describe('Back and Forward', () => {
  it('Back while dirty opens the dialog and the address stays', async () => {
    await dirty();
    browserMovesToAnotherEntry();
    expect(await waitForDialog()).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    // The entry that Back used up is pushed again, so another Back asks again
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(window.history.state).toMatchObject({ idraftLayoutLeaveGuard: true });
    expect(go).not.toHaveBeenCalled();
    expect(stateOf()).toBe('customize 1');
  });

  it('Keep editing after Back stays: the draft is kept and nothing moves', async () => {
    const { user } = await dirty();
    browserMovesToAnotherEntry();
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });
    expect(go).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(stateOf()).toBe('customize 1');
    await waitFor(() => {
      expect(firstHandle()).toHaveFocus();
    });
  });

  it('Discard after Back goes back past the entry that was pushed again', async () => {
    const { user } = await dirty();
    browserMovesToAnotherEntry();
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(go).toHaveBeenCalledExactlyOnceWith(-2);
    expect(back).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('Forward onto an entry that is not the guard entry asks as well', async () => {
    await dirty();
    // Entries ahead of the guard's are cut off when it is pushed, so a Forward can only meet an older one
    browserMovesToAnotherEntry();
    expect(await waitForDialog()).toBeInTheDocument();
  });

  it('a move onto the guard entry itself (Back from an entry above it) asks nothing', async () => {
    await dirty();
    window.history.pushState({ entry: 'filtered' }, '');
    // Back from the filtered entry lands on the guard entry again
    window.history.replaceState({ idraftLayoutLeaveGuard: true }, '');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { idraftLayoutLeaveGuard: true } }));
    });
    expect(discardDialog()).toBeNull();
    expect(stateOf()).toBe('customize 1');
  });

  it('Back with no changes is left to the browser', async () => {
    const { user } = renderScreen();
    await startCustomizing(user);
    browserMovesToAnotherEntry();
    expect(discardDialog()).toBeNull();
    expect(pushState).not.toHaveBeenCalled();
    expect(stateOf()).toBe('customize 0');
  });
});

describe('a navigation without changes', () => {
  it('ends the mode quietly', async () => {
    const { user } = renderScreen();
    await startCustomizing(user);
    act(() => {
      navigateTo('/acme/keywords');
    });
    expect(stateOf()).toBe('view 0');
    expect(discardDialog()).toBeNull();
  });

  it('leaves the mode alone while there are changes', async () => {
    await dirty();
    act(() => {
      navigateTo('/acme/keywords');
    });
    expect(stateOf()).toBe('customize 1');
    expect(discardDialog()).toBeNull();
  });

  it('does nothing on a screen that is not in the mode', async () => {
    renderScreen();
    act(() => {
      navigateTo('/acme/keywords');
    });
    expect(stateOf()).toBe('view 0');
  });
});

describe('closing or reloading the tab', () => {
  const unload = (): Event => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  it('asks the browser while dirty only', async () => {
    const { user } = renderScreen();
    await startCustomizing(user);
    expect(unload().defaultPrevented).toBe(false);
    await user.click(inScreen('Edit'));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 1');
    });
    expect(unload().defaultPrevented).toBe(true);
  });
});

describe('after the mode has ended', () => {
  it('the guard is gone: a link, Back and a reload are left to the browser', async () => {
    const { user } = await dirty();
    await user.click(inScreen('Leave'));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(guardHeldClickOn('Settings')).toBe(false);
    browserMovesToAnotherEntry();
    expect(discardDialog()).toBeNull();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it('a question that was answered does not come back with the next mode', async () => {
    const { user } = await dirty();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await waitForDialog();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    router.replace.mockClear();
    await user.click(screen.getByRole('button', { name: 'Menu entry' }));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
    await user.click(inScreen('Edit'));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 1');
    });
    expect(discardDialog()).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('while a save is under way', () => {
  it('a link and Back are held and nothing is asked: the mode stays until the save is answered', async () => {
    const held = gate();
    serveLayouts({ holdSave: held.promise });
    const { user } = await dirty();
    await user.click(inScreen('Save now'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Customize' })).toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    browserMovesToAnotherEntry();
    expect(discardDialog()).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    held.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(discardDialog()).toBeNull();
  });
});
