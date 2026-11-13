import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LayoutProviderModule from '../layout-provider';
import type { LayoutContextValue } from '../layout-provider';
import { ScreenUnderTest, box, serveLayouts, startCustomizing, stateOf, stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/** Lets one test change what the screen's context says (the actions), the rest read it as it is. */
const patch: { current: ((value: LayoutContextValue) => LayoutContextValue) | null } = { current: null };
vi.mock('../layout-provider', async (importOriginal) => {
  const original = await importOriginal<typeof LayoutProviderModule>();
  return {
    ...original,
    useLayoutScreen: (): LayoutContextValue => {
      const value = original.useLayoutScreen();
      return patch.current === null ? value : patch.current(value);
    },
  };
});

beforeEach(() => {
  patch.current = null;
  stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Customize mode with one edit made, so there is a change to undo. */
async function edited(): Promise<ProvidedRender> {
  const view = renderWithProviders(<ScreenUnderTest />);
  await startCustomizing(view.user);
  await view.user.click(within(box()).getByRole('button', { name: 'Edit' }));
  await waitFor(() => {
    expect(stateOf()).toBe('customize 1');
  });
  return view;
}

const edit = (): HTMLElement => within(box()).getByRole('button', { name: 'Edit' });

describe('Undo and Redo keys', () => {
  it.each([['{Control>}z{/Control}'], ['{Meta>}z{/Meta}']])('undo with %s', async (keys) => {
    serveLayouts();
    const { user } = await edited();
    edit().focus();
    await user.keyboard(keys);
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
  });

  it.each([['{Shift>}{Control>}z{/Control}{/Shift}'], ['{Shift>}{Meta>}z{/Meta}{/Shift}']])(
    'redo with %s',
    async (keys) => {
      serveLayouts();
      const { user } = await edited();
      edit().focus();
      await user.keyboard('{Control>}z{/Control}');
      await waitFor(() => {
        expect(stateOf()).toBe('customize 0');
      });
      await user.keyboard(keys);
      await waitFor(() => {
        expect(stateOf()).toBe('customize 1');
      });
    },
  );

  it('takes the key from the browser only when it acted', async () => {
    serveLayouts();
    await edited();
    edit().focus();
    expect(fireEvent.keyDown(edit(), { key: 'z', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(edit(), { key: 'z', ctrlKey: true })).toBe(true);
  });

  it('leaves the keys of a text field to the field', async () => {
    serveLayouts();
    const { user } = await edited();
    await user.click(screen.getByRole('textbox', { name: 'Note' }));
    await user.keyboard('{Control>}z{/Control}');
    expect(stateOf()).toBe('customize 1');
  });

  it('leaves the keys of a combobox to the combobox', async () => {
    serveLayouts();
    const { user } = await edited();
    const width = within(box()).getAllByRole('combobox')[0] as HTMLElement;
    width.focus();
    await user.keyboard('{Control>}z{/Control}');
    expect(stateOf()).toBe('customize 1');
  });

  it('leaves the keys of an open menu to the menu', async () => {
    serveLayouts();
    const { user } = await edited();
    await user.click(within(box()).getAllByRole('button', { name: /^Move / })[0] as HTMLElement);
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'z', ctrlKey: true });
    expect(stateOf()).toBe('customize 1');
  });

  it('does not call undo or redo in view mode, even when the provider has history to give', async () => {
    serveLayouts();
    const undo = vi.fn(() => true);
    const redo = vi.fn(() => true);
    patch.current = (value) => ({ ...value, actions: { ...value.actions, undo, redo } });
    renderWithProviders(<ScreenUnderTest />);
    // Not the text field: a key there is ignored for another reason
    const target = await screen.findByRole('button', { name: 'Menu entry' });
    expect(fireEvent.keyDown(target, { key: 'z', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(target, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    expect(stateOf()).toBe('view 0');
  });

  it('does nothing while a save is under way', async () => {
    const release = gate();
    serveLayouts({ holdSave: release.promise });
    const { user } = await edited();
    await user.click(within(box()).getByRole('button', { name: 'Save now' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Customize' })).toHaveAttribute('aria-disabled', 'true');
    });
    edit().focus();
    expect(fireEvent.keyDown(edit(), { key: 'z', ctrlKey: true })).toBe(true);
    expect(stateOf()).toBe('customize 1');
    release.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });
});
