import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCustomizeMenuItem } from './customize-button';
import type { MenuItemDef } from '@/components/ui/menu';
import { gate } from '@/test/gate';
import {
  ScreenUnderTest,
  box,
  customizeButton,
  loaded,
  serveLayouts,
  startCustomizing,
  stateOf,
  stubViewport,
} from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CustomizeButton', () => {
  it('is a toggle that says whether the mode is on', async () => {
    serveLayouts();
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await loaded();
    expect(customizeButton()).toHaveAttribute('aria-pressed', 'false');
    await user.click(customizeButton());
    await waitFor(() => {
      expect(customizeButton()).toHaveAttribute('aria-pressed', 'true');
    });
    await user.click(customizeButton());
    await waitFor(() => {
      expect(customizeButton()).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('has the SlidersHorizontal icon, hidden from assistive technology', async () => {
    serveLayouts();
    renderWithProviders(<ScreenUnderTest />);
    await loaded();
    expect(customizeButton().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is disabled, and says why, while the layout has not loaded', async () => {
    serveLayouts({ read: 'error' });
    renderWithProviders(<ScreenUnderTest />);
    const button = customizeButton();
    await screen.findByText('Your layout could not be loaded. Showing the default.');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Available once your layout has loaded');
  });

  it('does not start the mode when it is disabled', async () => {
    serveLayouts({ read: 'error' });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await user.click(customizeButton());
    expect(stateOf()).toBe('view 0');
  });

  it('is disabled while a save is under way', async () => {
    const release = gate();
    serveLayouts({ holdSave: release.promise });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await user.click(within(box()).getByRole('button', { name: 'Edit' }));
    await user.click(within(box()).getByRole('button', { name: 'Save now' }));
    await waitFor(() => {
      expect(customizeButton()).toHaveAttribute('aria-disabled', 'true');
    });
    release.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('is hidden below 768 px, by its classes', async () => {
    serveLayouts();
    renderWithProviders(<ScreenUnderTest />);
    await loaded();
    expect(customizeButton()).toHaveClass('hidden', 'md:inline-flex');
  });

  it('asks to leave when pressed again with changes', async () => {
    serveLayouts();
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await user.click(within(box()).getByRole('button', { name: 'Edit' }));
    await user.click(customizeButton());
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    expect(stateOf()).toBe('customize 1');
  });

  it('is also a menu item, for a header with no room for the button', async () => {
    serveLayouts();
    const picked: (MenuItemDef | null)[] = [];
    function Probe(): null {
      picked.push(useCustomizeMenuItem('customizeCards'));
      return null;
    }
    const { user } = renderWithProviders(<ScreenUnderTest extra={<Probe />} />);
    await startCustomizing(user);
    const item = picked.at(-1);
    expect(item).toMatchObject({ id: 'customize', label: 'Customize cards' });
    expect(item?.disabledReason).toBeUndefined();
  });

  it('has no menu item on a window narrower than 768 px, where there is no customize mode', async () => {
    serveLayouts();
    stubViewport(47);
    const picked: (MenuItemDef | null)[] = [];
    function Probe(): null {
      picked.push(useCustomizeMenuItem());
      return null;
    }
    renderWithProviders(<ScreenUnderTest extra={<Probe />} />);
    await loaded();
    expect(picked.at(-1)).toBeNull();
  });

  it('gives the menu item the reason when the layout has not loaded', async () => {
    serveLayouts({ read: 'error' });
    const picked: (MenuItemDef | null)[] = [];
    function Probe(): null {
      picked.push(useCustomizeMenuItem());
      return null;
    }
    renderWithProviders(<ScreenUnderTest extra={<Probe />} />);
    await screen.findByText('Your layout could not be loaded. Showing the default.');
    expect(picked.at(-1)?.disabledReason).toBe('Available once your layout has loaded');
  });

  describe('the menu item when it is chosen', () => {
    const picked: (MenuItemDef | null)[] = [];
    const returnFocus: { current: HTMLElement | null } = { current: null };
    function Probe(): null {
      picked.push(useCustomizeMenuItem('customize', returnFocus));
      return null;
    }
    const choose = (): void => {
      act(() => {
        picked.at(-1)?.onSelect?.();
      });
    };
    beforeEach(() => {
      picked.length = 0;
      returnFocus.current = null;
    });

    it('starts the mode, and gives focus back to the menu trigger when the mode ends', async () => {
      serveLayouts();
      const { user } = renderWithProviders(<ScreenUnderTest extra={<Probe />} />);
      await loaded();
      returnFocus.current = screen.getByRole('button', { name: 'Menu entry' });
      choose();
      await waitFor(() => {
        expect(stateOf()).toBe('customize 0');
      });
      await user.click(screen.getByRole('button', { name: 'Leave' }));
      expect(returnFocus.current).toHaveFocus();
    });

    it('leaves the mode when it is on, and asks first with changes', async () => {
      serveLayouts();
      const { user } = renderWithProviders(<ScreenUnderTest extra={<Probe />} />);
      await startCustomizing(user);
      await user.click(within(box()).getByRole('button', { name: 'Edit' }));
      choose();
      expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Discard changes' }));
      await waitFor(() => {
        expect(stateOf()).toBe('view 0');
      });
      await startCustomizing(user);
      choose();
      await waitFor(() => {
        expect(stateOf()).toBe('view 0');
      });
    });

    it('is ignored while a save is under way', async () => {
      const release = gate();
      serveLayouts({ holdSave: release.promise });
      const { user } = renderWithProviders(<ScreenUnderTest extra={<Probe />} />);
      await startCustomizing(user);
      await user.click(within(box()).getByRole('button', { name: 'Edit' }));
      await user.click(within(box()).getByRole('button', { name: 'Save now' }));
      await waitFor(() => {
        expect(customizeButton()).toHaveAttribute('aria-disabled', 'true');
      });
      choose();
      expect(stateOf()).toBe('customize 1');
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      release.open();
      await waitFor(() => {
        expect(stateOf()).toBe('view 0');
      });
    });
  });

  it.each([
    ['customizeCards', 'Customize cards'],
    ['customizeNumbers', 'Customize numbers'],
  ] as const)('names itself after the part that is customized: %s', async (label, name) => {
    serveLayouts();
    renderWithProviders(<ScreenUnderTest buttonLabel={label} />);
    expect(await screen.findByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
  });
});
