import { act, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCustomize } from '../customize/customize-controller';
import type { LayoutDocument } from '@/lib/layouts';
import {
  ScreenUnderTest,
  box,
  customizeButton,
  serveLayouts,
  startCustomizing,
  stateOf,
  stubViewport,
} from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const SET_TITLE = 'Set this as the default for everyone in Acme?';
const REMOVE_TITLE = 'Remove the team default?';
const COUNT = /^(No changes|\d+ changes?)$/;

const TEAM: LayoutDocument = { schema: 1, numbers: [], cards: [{ id: 't1', type: 'ai.by_engine', width: 'full' }] };
/** A team default exists, and the person follows the built-in layout. */
const WITH_TEAM = { team_default_exists: true, team_document: TEAM };

let viewport: ReturnType<typeof stubViewport>;
beforeEach(() => {
  serveLayouts();
  viewport = stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type User = ReturnType<typeof renderWithProviders>['user'];

const bar = (name: string): HTMLElement => screen.getByRole('group', { name });
const control = (name: string, group: string): HTMLElement => within(bar(group)).getByRole('button', { name });
const chevron = (group: string): HTMLElement => control('More save options', group);
const toastText = (): string => document.querySelector('[data-slot="toast"]')?.textContent ?? '';

/** The harness's Edit hides the first card, once per press. */
async function edit(user: User, total = 1): Promise<void> {
  await user.click(within(box()).getByRole('button', { name: 'Edit' }));
  await waitFor(() => {
    expect(stateOf()).toBe(`customize ${String(total)}`);
  });
}

/** Opens the menu of the chevron and waits for focus to move into it. */
async function openMenu(user: User, group: string): Promise<HTMLElement> {
  await user.click(chevron(group));
  const menu = await screen.findByRole('menu');
  await waitFor(() => {
    expect(menu.contains(document.activeElement)).toBe(true);
  });
  return menu;
}

/** Picks an item of the menu and waits for the dialog it asks in, with focus on its first button. */
async function ask(user: User, group: string, item: string, title: string): Promise<HTMLElement> {
  const menu = await openMenu(user, group);
  await user.click(within(menu).getByRole('menuitem', { name: item }));
  const dialog = await screen.findByRole('alertdialog', { name: title });
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  return dialog;
}

function ConflictProbe(): ReactElement {
  const { conflict, conflictPending } = useCustomize();
  return (
    <div>
      <p data-testid="conflict">{conflict ?? 'none'}</p>
      <p data-testid="pending">{conflictPending ?? 'none'}</p>
    </div>
  );
}

describe('TeamDefaultMenu', () => {
  it('is not rendered without layouts:manage', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest workspaceRole="editor" />);
    await startCustomizing(user);
    expect(within(bar('No changes')).queryByRole('button', { name: 'More save options' })).toBeNull();
    expect(within(bar('No changes')).getByRole('button', { name: 'Save layout' })).toBeInTheDocument();
  });

  it('lists Save as team default only, while there is no team default', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    const menu = await openMenu(user, 'No changes');
    expect(within(menu).getByRole('menuitem', { name: 'Save as team default' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Remove team default' })).toBeNull();
  });

  it('lists Remove team default too when a team default exists', async () => {
    serveLayouts({ layout: WITH_TEAM });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    const menu = await openMenu(user, 'No changes');
    expect(within(menu).getByRole('menuitem', { name: 'Save as team default' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Remove team default' })).toBeInTheDocument();
  });

  it('keeps the chevron usable at 0 changes, when Save is disabled', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(control('Save layout', 'No changes')).toBeDisabled();
    expect(chevron('No changes')).toBeEnabled();
    await openMenu(user, 'No changes');
  });

  it('joins Save as the other half of one split button', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(control('Save layout', 'No changes')).toHaveClass('rounded-r-none');
    expect(chevron('No changes')).toHaveClass('rounded-l-none');
  });

  it('asks before Save as team default, then saves, leaves the mode and toasts with the screen and workspace', async () => {
    const served = serveLayouts();
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    const dialog = await ask(user, '1 change', 'Save as team default', SET_TITLE);
    expect(dialog).toHaveTextContent('People who have customized this page keep their own layout.');
    expect(served.teamPuts).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Set team default' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(served.teamPuts).toHaveLength(1);
    expect(served.puts).toEqual([]);
    await waitFor(() => {
      expect(toastText()).toContain('Team default set');
    });
    expect(toastText()).toContain('Overview now opens with this layout for Acme.');
    expect(screen.queryByRole('group', { name: COUNT })).toBeNull();
    await waitFor(() => {
      expect(customizeButton()).toHaveFocus();
    });
  });

  it('still says the team default is set when the personal layout it replaces could not be removed', async () => {
    const served = serveLayouts({ layout: { source: 'personal', document: TEAM }, deleteStatus: 500 });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    const dialog = await ask(user, '1 change', 'Save as team default', SET_TITLE);
    await user.click(within(dialog).getByRole('button', { name: 'Set team default' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(served.teamPuts).toHaveLength(1);
    expect(served.deletes).toEqual(['personal']);
    await waitFor(() => {
      expect(toastText()).toContain('Team default set');
    });
    expect(toastText()).not.toContain('could not be saved');
  });

  it('can set the current layout as the team default with no changes', async () => {
    const served = serveLayouts();
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    const dialog = await ask(user, 'No changes', 'Save as team default', SET_TITLE);
    await user.click(within(dialog).getByRole('button', { name: 'Set team default' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(served.teamPuts).toHaveLength(1);
  });

  it('writes nothing when the confirm is cancelled, and gives focus back to the chevron', async () => {
    const served = serveLayouts();
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    const dialog = await ask(user, '1 change', 'Save as team default', SET_TITLE);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(served.teamPuts).toEqual([]);
    expect(stateOf()).toBe('customize 1');
    await waitFor(() => {
      expect(chevron('1 change')).toHaveFocus();
    });
  });

  it('asks before Remove team default, then removes it and leaves the mode when there are no changes', async () => {
    const served = serveLayouts({ layout: WITH_TEAM });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    const dialog = await ask(user, 'No changes', 'Remove team default', REMOVE_TITLE);
    expect(dialog).toHaveTextContent(
      'People in Acme who have not customized this page go back to the built-in layout.',
    );
    expect(served.teamDeletes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Remove team default' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(served.teamDeletes).toHaveLength(1);
    await waitFor(() => {
      expect(toastText()).toContain('Team default removed');
    });
    expect(toastText()).not.toContain('unsaved');
  });

  it('keeps the mode and the draft when Remove team default is chosen with changes, and says so', async () => {
    const served = serveLayouts({ layout: WITH_TEAM });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    const dialog = await ask(user, '1 change', 'Remove team default', REMOVE_TITLE);
    await user.click(within(dialog).getByRole('button', { name: 'Remove team default' }));
    await waitFor(() => {
      expect(toastText()).toContain('Team default removed');
    });
    expect(toastText()).toContain('Your unsaved changes are still here.');
    expect(served.teamDeletes).toHaveLength(1);
    expect(stateOf()).toBe('customize 1');
    expect(bar('1 change')).toBeInTheDocument();
    // The default is gone, so the menu no longer offers to remove it
    const menu = await openMenu(user, '1 change');
    expect(within(menu).queryByRole('menuitem', { name: 'Remove team default' })).toBeNull();
  });

  it('keeps the mode and toasts the failure when the team write fails', async () => {
    const served = serveLayouts({ putStatus: 500 });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    const dialog = await ask(user, '1 change', 'Save as team default', SET_TITLE);
    await user.click(within(dialog).getByRole('button', { name: 'Set team default' }));
    await waitFor(() => {
      expect(toastText()).toContain('The team default could not be saved. Try again.');
    });
    expect(served.teamPuts).toHaveLength(1);
    expect(stateOf()).toBe('customize 1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens the conflict dialog for the team write when the team default was changed elsewhere', async () => {
    serveLayouts({ putStatus: 412 });
    const { user } = renderWithProviders(<ScreenUnderTest extra={<ConflictProbe />} />);
    await startCustomizing(user);
    await edit(user);
    const dialog = await ask(user, '1 change', 'Save as team default', SET_TITLE);
    await user.click(within(dialog).getByRole('button', { name: 'Set team default' }));
    await waitFor(() => {
      expect(screen.getByTestId('conflict')).toHaveTextContent('team');
    });
    expect(screen.getByTestId('pending')).toHaveTextContent('team');
    expect(await screen.findByRole('dialog', { name: 'This layout was changed somewhere else.' })).toBeVisible();
    expect(stateOf()).toBe('customize 1');
  });

  it('refuses to write while a conflict has not been answered, and asks the question again', async () => {
    const served = serveLayouts({ putStatus: 412 });
    const { user } = renderWithProviders(<ScreenUnderTest extra={<ConflictProbe />} />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Save layout', '1 change'));
    const question = await screen.findByRole('dialog', { name: 'This layout was changed somewhere else.' });
    await user.click(within(question).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByTestId('pending')).toHaveTextContent('personal');
    const menu = await openMenu(user, '1 change');
    await user.click(within(menu).getByRole('menuitem', { name: 'Save as team default' }));
    expect(await screen.findByRole('dialog', { name: 'This layout was changed somewhere else.' })).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(served.teamPuts).toEqual([]);
    expect(served.puts).toHaveLength(1);
  });

  it('disables the chevron while a save is under way', async () => {
    const held = gate();
    serveLayouts({ holdSave: held.promise });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Save layout', '1 change'));
    await waitFor(() => {
      expect(control('Save layout', '1 change')).toHaveAttribute('aria-busy', 'true');
    });
    expect(chevron('1 change')).toHaveAttribute('aria-disabled', 'true');
    held.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('writes nothing when the mode ends while the confirm is open: the dialog goes with it', async () => {
    const served = serveLayouts({ layout: WITH_TEAM });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await ask(user, 'No changes', 'Remove team default', REMOVE_TITLE);
    // A window narrowed below 768 px ends a clean customize mode
    act(() => {
      viewport.setWidth(40);
    });
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(served.teamDeletes).toEqual([]);
    expect(served.teamPuts).toEqual([]);
  });
});
