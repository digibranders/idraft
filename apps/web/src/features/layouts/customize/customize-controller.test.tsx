import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCustomize, type CustomizeContextValue } from './customize-controller';
import {
  ScreenUnderTest,
  box,
  customizeButton,
  firstHandle,
  loaded,
  serveLayouts,
  startCustomizing,
  stateOf,
  stubViewport,
} from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const DISCARD_TITLE = 'Discard unsaved changes?';

let viewport: ReturnType<typeof stubViewport>;

beforeEach(() => {
  serveLayouts();
  viewport = stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const discardDialog = (): HTMLElement | null => screen.queryByRole('alertdialog', { name: DISCARD_TITLE });
/** A change to the draft: the first card is hidden. */
const edit = async (user: ReturnType<typeof renderWithProviders>['user'], label = 'Screen'): Promise<void> => {
  await user.click(within(box(label)).getByRole('button', { name: 'Edit' }));
  await waitFor(() => {
    expect(stateOf(label)).toBe('customize 1');
  });
};

describe('useCustomize', () => {
  it('throws outside a customizable screen', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Outside(): null {
      useCustomize();
      return null;
    }
    expect(() => renderWithProviders(<Outside />)).toThrow('useCustomize is used outside a CustomizableScreen');
    consoleError.mockRestore();
  });
});

describe('entering', () => {
  it('starts customize mode and remembers the control that started it as the return target', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await loaded();
    const entry = screen.getByRole('button', { name: 'Menu entry' });
    await user.click(entry);
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(stateOf()).toBe('view 0');
    expect(entry).toHaveFocus();
  });

  it('ends a clean customize mode of another screen first', async () => {
    const { user } = renderWithProviders(
      <>
        <ScreenUnderTest label="First" />
        <ScreenUnderTest label="Second" screen="rankings" />
      </>,
    );
    await startCustomizing(user, 'First');
    await startCustomizing(user, 'Second');
    expect(stateOf('First')).toBe('view 0');
    expect(stateOf('Second')).toBe('customize 0');
    expect(discardDialog()).toBeNull();
  });

  it('asks first when the customize mode of another screen has changes', async () => {
    const { user } = renderWithProviders(
      <>
        <ScreenUnderTest label="First" />
        <ScreenUnderTest label="Second" screen="rankings" />
      </>,
    );
    await startCustomizing(user, 'First');
    await edit(user, 'First');
    await loaded('Second');
    await user.click(customizeButton('Second'));
    expect(await screen.findByRole('alertdialog', { name: DISCARD_TITLE })).toBeInTheDocument();
    expect(stateOf('Second')).toBe('view 0');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf('Second')).toBe('customize 0');
    });
    expect(stateOf('First')).toBe('view 0');
  });
});

describe('leaving', () => {
  it('with no changes exits and returns focus to the Customize button', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(stateOf()).toBe('view 0');
    expect(discardDialog()).toBeNull();
    await waitFor(() => {
      expect(customizeButton()).toHaveFocus();
    });
  });

  it('with changes opens the discard dialog and stays in customize mode', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('alertdialog', { name: DISCARD_TITLE })).toHaveAccessibleDescription(
      'Your layout changes will be lost.',
    );
    expect(stateOf()).toBe('customize 1');
  });

  it('keeps the draft on Keep editing and puts focus on the first handle', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });
    expect(stateOf()).toBe('customize 1');
    await waitFor(() => {
      expect(firstHandle()).toHaveFocus();
    });
  });

  it('exits and runs what was waiting on Discard', async () => {
    const then = vi.fn();
    const { user } = renderWithProviders(<ScreenUnderTest onThen={then} />);
    await startCustomizing(user);
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Leave and run' }));
    expect(then).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(then).toHaveBeenCalledOnce();
  });

  it('starts the next customize mode with no question left over', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    await startCustomizing(user);
    expect(discardDialog()).toBeNull();
  });

  it('runs what was waiting at once when there is nothing to discard', async () => {
    const then = vi.fn();
    const { user } = renderWithProviders(<ScreenUnderTest onThen={then} />);
    await startCustomizing(user);
    await user.click(screen.getByRole('button', { name: 'Leave and run' }));
    expect(stateOf()).toBe('view 0');
    expect(then).toHaveBeenCalledOnce();
  });

  it('does not leave focus where it is when it was outside the screen', async () => {
    const { user } = renderWithProviders(
      <>
        <ScreenUnderTest />
        <button type="button">Elsewhere</button>
      </>,
    );
    await startCustomizing(user);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });
});

describe('Escape', () => {
  it('leaves customize mode when there are no changes', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('asks first when there are changes', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    // Not on a drag handle: its tooltip is open while it has focus, and takes the first Escape
    within(box()).getByRole('button', { name: 'Edit' }).focus();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('alertdialog', { name: DISCARD_TITLE })).toBeInTheDocument();
    expect(stateOf()).toBe('customize 1');
  });

  it('does nothing when something else took the key first, as a card in the hand does', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    const take = (event: KeyboardEvent): void => event.preventDefault();
    document.addEventListener('keydown', take, true);
    try {
      await user.keyboard('{Escape}');
    } finally {
      document.removeEventListener('keydown', take, true);
    }
    expect(stateOf()).toBe('customize 0');
    expect(discardDialog()).toBeNull();
  });

  it('does nothing while a menu is open: the menu takes the key', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await user.click(within(box()).getAllByRole('button', { name: /^Move / })[0] as HTMLElement);
    const menu = await screen.findByRole('menu');
    await waitFor(() => {
      expect(menu).toContainElement(document.activeElement as HTMLElement);
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    expect(stateOf()).toBe('customize 0');
  });

  it('is the safe choice of the discard dialog: it keeps editing', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    within(box()).getByRole('button', { name: 'Edit' }).focus();
    await user.keyboard('{Escape}');
    await screen.findByRole('alertdialog', { name: DISCARD_TITLE });
    // The dialog takes focus when it has opened: a key sent before that goes to the page behind it
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(discardDialog()).toBeNull();
    });
    expect(stateOf()).toBe('customize 1');
  });
});

describe('while a save is under way', () => {
  /** Customize mode with one change and a save that has been sent and not answered. */
  async function saving(): Promise<{ user: ReturnType<typeof renderWithProviders>['user']; release: () => void }> {
    const held = gate();
    serveLayouts({ holdSave: held.promise });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(within(box()).getByRole('button', { name: 'Save now' }));
    await waitFor(() => {
      expect(customizeButton()).toHaveAttribute('aria-disabled', 'true');
    });
    return { user, release: held.open };
  }

  it('Escape does nothing: the mode stays and no question is asked', async () => {
    const { user, release } = await saving();
    within(box()).getByRole('button', { name: 'Edit' }).focus();
    await user.keyboard('{Escape}');
    expect(stateOf()).toBe('customize 1');
    expect(discardDialog()).toBeNull();
    release();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('leaving by a button does nothing either, and does not run what waits on it', async () => {
    const then = vi.fn();
    const held = gate();
    serveLayouts({ holdSave: held.promise });
    const { user } = renderWithProviders(<ScreenUnderTest onThen={then} />);
    await startCustomizing(user);
    await edit(user);
    await user.click(within(box()).getByRole('button', { name: 'Save now' }));
    await waitFor(() => {
      expect(customizeButton()).toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(within(box()).getByRole('button', { name: 'Leave and run' }));
    expect(stateOf()).toBe('customize 1');
    expect(discardDialog()).toBeNull();
    expect(then).not.toHaveBeenCalled();
    held.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('entering does nothing', async () => {
    const held = gate();
    serveLayouts({ holdSave: held.promise });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await loaded();
    // A write that is not a save of the draft: it can be under way while the screen is in view mode
    await user.click(screen.getByRole('button', { name: 'Remove default' }));
    await waitFor(() => {
      expect(customizeButton()).toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(screen.getByRole('button', { name: 'Menu entry' }));
    expect(stateOf()).toBe('view 0');
    held.open();
    await waitFor(() => {
      expect(customizeButton()).not.toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(screen.getByRole('button', { name: 'Menu entry' }));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
  });
});

describe('focus', () => {
  it('goes to the first handle when the mode starts with focus on nothing', async () => {
    const captured: { current: CustomizeContextValue | null } = { current: null };
    function Capture(): null {
      captured.current = useCustomize();
      return null;
    }
    renderWithProviders(<ScreenUnderTest extra={<Capture />} />);
    await loaded();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    expect(document.activeElement).toBe(document.body);
    act(() => {
      captured.current?.enter();
    });
    await waitFor(() => {
      expect(firstHandle()).toHaveFocus();
    });
  });

  it('stays where the person is when the mode starts with focus somewhere', async () => {
    const captured: { current: CustomizeContextValue | null } = { current: null };
    function Capture(): null {
      captured.current = useCustomize();
      return null;
    }
    renderWithProviders(<ScreenUnderTest extra={<Capture />} />);
    await loaded();
    const note = screen.getByRole('textbox', { name: 'Note' });
    note.focus();
    act(() => {
      captured.current?.enter();
    });
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
    expect(note).toHaveFocus();
  });

  it('goes back to the Customize button after Discard', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    await waitFor(() => {
      expect(customizeButton()).toHaveFocus();
    });
  });
});

describe('a window narrower than 768 px', () => {
  it('leaves a clean customize mode', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    viewport.setWidth(47);
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('keeps a customize mode that has changes, with its controls', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    viewport.setWidth(47);
    await waitFor(() => {
      expect(stateOf()).toBe('customize 1');
    });
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
  });

  it('does not leave a mode that was started on a narrow window by the first read of the width', async () => {
    viewport.setWidth(47);
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await loaded();
    // The button is hidden there, but a menu item may start the mode: the width has not changed, so it stays
    await user.click(screen.getByRole('button', { name: 'Menu entry' }));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
  });
});
