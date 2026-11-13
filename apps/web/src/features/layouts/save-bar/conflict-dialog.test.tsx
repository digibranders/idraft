import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCustomize } from '../customize/customize-controller';
import { useLayoutScreen } from '../layout-provider';
import { SCREENS } from '@/lib/layouts';
import {
  ScreenUnderTest,
  box,
  serveLayouts,
  startCustomizing,
  stateOf,
  stubViewport,
  type ServedLayouts,
} from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { renderWithProviders } from '@/test/render';

const TITLE = 'This layout was changed somewhere else.';
const FAILED = 'Could not save. Try again.';

beforeEach(() => {
  serveLayouts();
  stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type User = ReturnType<typeof renderWithProviders>['user'];

const bar = (name: string): HTMLElement => screen.getByRole('group', { name });
const control = (name: string, group: string): HTMLElement => within(bar(group)).getByRole('button', { name });
const question = (): HTMLElement => screen.getByRole('dialog', { name: TITLE });
const answer = (name: string): HTMLElement => within(question()).getByRole('button', { name });
const pendingOf = (): string => screen.getByTestId('pending').textContent ?? '';
const conflictOf = (): string => screen.getByTestId('conflict').textContent ?? '';
const toastText = (): string => document.querySelector('[data-slot="toast"]')?.textContent ?? '';

function ConflictProbe(): ReactElement {
  const { conflict, conflictPending } = useCustomize();
  const { document: draft } = useLayoutScreen();
  return (
    <div>
      <p data-testid="conflict">{conflict ?? 'none'}</p>
      <p data-testid="pending">{conflictPending ?? 'none'}</p>
      <p data-testid="draft">{(draft.cards ?? []).map((card) => card.id).join(',')}</p>
    </div>
  );
}

/** The team default as someone else saved it: three cards, over a personal layout of the built-in cards. */
const OTHER_TEAM = (): Record<string, unknown> => ({
  source: 'personal',
  document: SCREENS.overview.builtin,
  team_default_exists: true,
  team_document: {
    schema: 1,
    numbers: [],
    cards: [
      { id: 't1', type: 'ai.by_engine', width: 'half' },
      { id: 't2', type: 'seo.rank_distribution', width: 'half' },
      { id: 't3', type: 'trend.visibility_mentions', width: 'full' },
    ],
  },
});

/** The layout as the other writer left it: a personal layout saved by Ana Brandt three minutes ago. */
const OTHER_VERSION = (): Record<string, unknown> => ({
  source: 'personal',
  document: SCREENS.overview.builtin,
  updated_at: new Date(Date.now() - 3 * 60_000).toISOString(),
  updated_by: { user_id: 'u-ana', name: 'Ana Brandt' },
});

/** The harness's Edit hides the first card, once per press. */
async function edit(user: User, total = 1): Promise<void> {
  await user.click(within(box()).getByRole('button', { name: 'Edit' }));
  await waitFor(() => {
    expect(stateOf()).toBe(`customize ${String(total)}`);
  });
}

/** Customize mode with one change, saved once and answered with a 412: the question is open. */
async function conflicted(
  options: Parameters<typeof serveLayouts>[0] = {},
): Promise<{ user: User; served: ServedLayouts }> {
  const served = serveLayouts({ putStatus: [412, 200], ...options });
  const { user } = renderWithProviders(<ScreenUnderTest extra={<ConflictProbe />} />);
  await startCustomizing(user);
  await edit(user);
  await user.click(control('Save layout', '1 change'));
  await screen.findByRole('dialog', { name: TITLE });
  return { user, served };
}

/** Set as the team default and answered with a 412: the question is open for the team write. */
async function teamConflicted(
  options: Parameters<typeof serveLayouts>[0] = {},
): Promise<{ user: User; served: ServedLayouts }> {
  const served = serveLayouts({ putStatus: [412, 200], ...options });
  const { user } = renderWithProviders(<ScreenUnderTest extra={<ConflictProbe />} />);
  await startCustomizing(user);
  await edit(user);
  await user.click(control('More save options', '1 change'));
  await user.click(await screen.findByRole('menuitem', { name: 'Save as team default' }));
  const confirm = await screen.findByRole('alertdialog', { name: /Set this as the default/ });
  await waitFor(() => {
    expect(confirm.contains(document.activeElement)).toBe(true);
  });
  await user.click(within(confirm).getByRole('button', { name: 'Set team default' }));
  await screen.findByRole('dialog', { name: TITLE });
  return { user, served };
}

describe('LayoutConflictDialog', () => {
  it('opens on a personal 412 with focus on Load the other version', async () => {
    await conflicted();
    expect(conflictOf()).toBe('personal');
    expect(question()).toHaveTextContent(
      'Keep mine saves your layout over the other version. Load the other version drops your changes.',
    );
    await waitFor(() => {
      expect(answer('Load the other version')).toHaveFocus();
    });
    expect(stateOf()).toBe('customize 1');
  });

  it('names who saved the other version and when', async () => {
    await conflicted({ layout: OTHER_VERSION() });
    expect(question()).toHaveTextContent('Saved by Ana Brandt, 3m ago');
  });

  it('leaves the line out when the API does not say who saved the other version', async () => {
    await conflicted();
    expect(question()).not.toHaveTextContent('Saved by');
  });

  it('Keep mine reads the layout again and puts the draft, never a plain save', async () => {
    const { user, served } = await conflicted({ layout: OTHER_VERSION() });
    const readsBefore = served.reads;
    expect(served.puts).toHaveLength(1);
    await user.click(answer('Keep mine'));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(served.puts).toHaveLength(2);
    // `saveAnyway` reads before it writes: a plain save would have sent the second put with no read
    expect(served.reads).toBe(readsBefore + 1);
    expect(served.teamPuts).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps focus on Load the other version when the team confirm that led here finishes closing', async () => {
    await teamConflicted();
    // The confirm hands focus back to the chevron when it has closed, which is after this dialog has opened
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(answer('Load the other version')).toHaveFocus();
  });

  it('Load the other version after a team 412 loads the team default, not the personal layout', async () => {
    const { user, served } = await teamConflicted({ layout: OTHER_TEAM() });
    await user.click(answer('Load the other version'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByTestId('draft')).toHaveTextContent(/^t1,t2,t3$/);
    expect(stateOf()).toBe('customize 0');
    expect(conflictOf()).toBe('none');
    expect(pendingOf()).toBe('none');
    expect(served.teamPuts).toHaveLength(1);
    expect(served.puts).toEqual([]);
  });

  it('a click on the scrim puts the dialog away, and Save asks again without writing', async () => {
    const { user, served } = await conflicted();
    const scrim = document.querySelector('[data-slot="dialog-scrim"]');
    if (scrim === null) throw new Error('the dialog has no scrim');
    await user.click(scrim);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(pendingOf()).toBe('personal');
    expect(stateOf()).toBe('customize 1');
    await user.click(control('Save layout', '1 change'));
    expect(await screen.findByRole('dialog', { name: TITLE })).toBeVisible();
    expect(served.puts).toHaveLength(1);
  });

  it('asks the team question again after Escape, an edit and a personal Save, with no personal write', async () => {
    const { user, served } = await teamConflicted();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(pendingOf()).toBe('team');
    await edit(user, 2);
    await user.click(control('Save layout', '2 changes'));
    expect(await screen.findByRole('dialog', { name: TITLE })).toBeVisible();
    expect(conflictOf()).toBe('team');
    expect(served.puts).toEqual([]);
    expect(served.teamPuts).toHaveLength(1);
  });

  it('writes once for two quick clicks on Keep mine of a personal conflict', async () => {
    const { served } = await conflicted();
    const keep = answer('Keep mine');
    act(() => {
      fireEvent.click(keep);
      fireEvent.click(keep);
    });
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(served.puts).toHaveLength(2);
  });

  it('writes and toasts once for two quick clicks on Keep mine of a team conflict', async () => {
    const { served } = await teamConflicted();
    const keep = answer('Keep mine');
    act(() => {
      fireEvent.click(keep);
      fireEvent.click(keep);
    });
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    await waitFor(() => {
      expect(toastText()).toContain('Team default set');
    });
    expect(served.teamPuts).toHaveLength(2);
    expect(document.querySelectorAll('[data-slot="toast"]')).toHaveLength(1);
  });

  it('Keep mine after a team 412 saves the team default again, not the personal layout', async () => {
    const { user, served } = await teamConflicted();
    expect(conflictOf()).toBe('team');
    await user.click(answer('Keep mine'));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(served.teamPuts).toHaveLength(2);
    expect(served.puts).toEqual([]);
    await waitFor(() => {
      expect(toastText()).toContain('Team default set');
    });
  });

  it('Load the other version takes the layout as it is now, closes, and writes nothing more', async () => {
    const { user, served } = await conflicted({ layout: OTHER_VERSION() });
    await user.click(answer('Load the other version'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(stateOf()).toBe('customize 0');
    expect(conflictOf()).toBe('none');
    expect(pendingOf()).toBe('none');
    expect(served.puts).toHaveLength(1);
  });

  it('Escape closes the dialog and keeps the draft, the mode and the way to Cancel', async () => {
    const { user, served } = await conflicted();
    await waitFor(() => {
      expect(answer('Load the other version')).toHaveFocus();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(stateOf()).toBe('customize 1');
    expect(conflictOf()).toBe('none');
    expect(pendingOf()).toBe('personal');
    // Save asks the question again and sends nothing
    await user.click(control('Save layout', '1 change'));
    expect(await screen.findByRole('dialog', { name: TITLE })).toBeVisible();
    expect(served.puts).toHaveLength(1);
    // And the person can still leave: Cancel asks about the changes, as always
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await user.click(control('Cancel', '1 change'));
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  });

  it('closes with its Close button the same way, leaving the conflict pending', async () => {
    const { user } = await conflicted();
    await user.click(within(question()).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(pendingOf()).toBe('personal');
    expect(stateOf()).toBe('customize 1');
  });

  it('disables the buttons while Keep mine is saving', async () => {
    const held = gate();
    const { user } = await conflicted({ holdSave: held.promise });
    await user.click(answer('Keep mine'));
    await waitFor(() => {
      expect(answer('Keep mine')).toHaveAttribute('aria-busy', 'true');
    });
    expect(answer('Load the other version')).toBeDisabled();
    // The dialog cannot be dismissed under a write: it is where the outcome is answered
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: TITLE })).toBeVisible();
    expect(conflictOf()).toBe('personal');
    held.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('stays open when Keep mine meets a second 412', async () => {
    const { user, served } = await conflicted({ putStatus: [412, 412, 200] });
    await user.click(answer('Keep mine'));
    await waitFor(() => {
      expect(served.puts).toHaveLength(2);
    });
    await waitFor(() => {
      expect(answer('Keep mine')).not.toHaveAttribute('aria-busy');
    });
    expect(screen.getByRole('dialog', { name: TITLE })).toBeVisible();
    expect(conflictOf()).toBe('personal');
    expect(stateOf()).toBe('customize 1');
    await user.click(answer('Keep mine'));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(served.puts).toHaveLength(3);
  });

  it('shows the save failure in the bar and keeps the conflict pending when Keep mine fails', async () => {
    const { user, served } = await conflicted({ putStatus: [412, 500] });
    await user.click(answer('Keep mine'));
    expect(await screen.findByText(FAILED)).toHaveAttribute('role', 'alert');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(pendingOf()).toBe('personal');
    expect(stateOf()).toBe('customize 1');
    expect(served.puts).toHaveLength(2);
    // Save does not write on its own: it asks again
    await user.click(control('Save layout', '1 change'));
    expect(await screen.findByRole('dialog', { name: TITLE })).toBeVisible();
    expect(served.puts).toHaveLength(2);
  });

  it('is gone with the mode', async () => {
    const { user } = await conflicted();
    await user.click(within(question()).getByRole('button', { name: 'Close' }));
    await user.click(control('Cancel', '1 change'));
    const discard = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(within(discard).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pendingOf()).toBe('none');
  });
});
