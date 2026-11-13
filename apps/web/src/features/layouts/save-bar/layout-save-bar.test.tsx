import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCustomize } from '../customize/customize-controller';
import { useLayoutScreen } from '../layout-provider';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import { SCREENS, type LayoutDocument } from '@/lib/layouts';
import {
  ScreenUnderTest,
  box,
  customizeButton,
  loaded,
  serveLayouts,
  startCustomizing,
  stateOf,
  stubViewport,
  type ServedLayouts,
} from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { renderWithProviders } from '@/test/render';

const SCOPE = 'Applies to your view, in every project';
const DIFFERS = 'Your layout differs from the team default. It applies to your view, in every project';
const DISCARD_TITLE = 'Discard unsaved changes?';
const FAILED = 'Could not save. Try again.';
/** The name of the save bar (a card can have "changes" in its name). */
const COUNT = /^(No changes|\d+ changes?)$/;

beforeEach(() => {
  serveLayouts();
  stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type User = ReturnType<typeof renderWithProviders>['user'];

/** The save bar: a group named by its change count. */
const bar = (name: string): HTMLElement => screen.getByRole('group', { name });
/** A control of the bar, found by name inside it. */
const control = (name: string, group: string): HTMLElement => within(bar(group)).getByRole('button', { name });
/** The failure line: the page also has an empty live region with the same role. */
const failure = (): HTMLElement | null => screen.queryByText(FAILED);
const polite = (): HTMLElement | null => document.getElementById(LIVE_REGION_ID.polite);
const isDisabled = (element: HTMLElement): boolean =>
  element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';

/** `times` changes of the draft (the harness's Edit hides the first card); the count then reads `total`. */
async function edit(user: User, times = 1, total = times): Promise<void> {
  for (let done = 0; done < times; done += 1) {
    await user.click(within(box()).getByRole('button', { name: 'Edit' }));
  }
  await waitFor(() => {
    expect(stateOf()).toBe(`customize ${String(total)}`);
  });
}

/** Shows the conflict state of the controller, which the dialog of the next task renders. */
function ConflictProbe(): ReactElement {
  const { conflict, conflictPending, dismissConflict, resolveConflict } = useCustomize();
  return (
    <div>
      <p data-testid="conflict">{conflict ?? 'none'}</p>
      <p data-testid="pending">{conflictPending ?? 'none'}</p>
      <button type="button" onClick={dismissConflict}>
        Dismiss dialog
      </button>
      <button type="button" onClick={resolveConflict}>
        Resolve conflict
      </button>
    </div>
  );
}

/** The cards and numbers of the draft that renders, by id. */
function DraftProbe(): ReactElement {
  const { document: draft } = useLayoutScreen();
  const ids = (items: readonly { id: string }[] | undefined): string => (items ?? []).map((item) => item.id).join(',');
  return <p data-testid="draft">{`cards ${ids(draft.cards)} numbers ${ids(draft.numbers)}`}</p>;
}

const TEAM: LayoutDocument = { schema: 1, numbers: [], cards: [{ id: 't1', type: 'ai.by_engine', width: 'full' }] };

/** A personal layout (the built-in one) over a team default that differs from it. */
function personalOverTeam(): ServedLayouts {
  return serveLayouts({
    layout: {
      source: 'personal',
      document: SCREENS.overview.builtin,
      team_default_exists: true,
      team_document: TEAM,
    },
  });
}

describe('LayoutSaveBar', () => {
  it('is hidden in view mode and shown in customize mode', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await loaded();
    expect(screen.queryByRole('group', { name: COUNT })).toBeNull();
    await startCustomizing(user);
    expect(bar('No changes')).toBeInTheDocument();
    await user.click(customizeButton());
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: COUNT })).toBeNull();
    });
  });

  it('is a group named by the change count: No changes, 1 change, 3 changes', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(bar('No changes')).toHaveTextContent('No changes');
    await edit(user);
    expect(bar('1 change')).toHaveTextContent('1 change');
    await edit(user, 2, 3);
    expect(bar('3 changes')).toHaveTextContent('3 changes');
  });

  it('says the layout applies to the view in every project', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(within(bar('No changes')).getByText(SCOPE)).toBeInTheDocument();
    expect(within(bar('No changes')).queryByText(DIFFERS)).toBeNull();
  });

  it('says the layout differs when the saved layout is personal and a team default exists', async () => {
    personalOverTeam();
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(within(bar('No changes')).getByText(DIFFERS)).toBeInTheDocument();
    expect(within(bar('No changes')).queryByText(SCOPE)).toBeNull();
  });

  it('disables Save at 0 changes and enables it after an edit', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(control('Save layout', 'No changes')).toBeDisabled();
    await edit(user);
    expect(control('Save layout', '1 change')).toBeEnabled();
  });

  it('saves, leaves the mode, shows no toast and gives focus back to the Customize button', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Save layout', '1 change'));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(screen.queryByRole('group', { name: COUNT })).toBeNull();
    expect(document.querySelector('[data-slot="toast"]')).toBeNull();
    await waitFor(() => {
      expect(customizeButton()).toHaveFocus();
    });
    expect(polite()).toHaveTextContent('Layout saved');
  });

  it('shows a failed save as an alert and keeps the draft, the mode and the focus on Save', async () => {
    serveLayouts({ putStatus: 500 });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Save layout', '1 change'));
    expect(await screen.findByText(FAILED)).toHaveAttribute('role', 'alert');
    expect(stateOf()).toBe('customize 1');
    expect(control('Save layout', '1 change')).toHaveFocus();
    expect(control('Save layout', '1 change')).not.toHaveAttribute('aria-busy');
  });

  it('clears the failure line on the next edit', async () => {
    serveLayouts({ putStatus: 500 });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Save layout', '1 change'));
    await screen.findByText(FAILED);
    await user.click(within(box()).getByRole('button', { name: 'Edit' }));
    await waitFor(() => {
      expect(failure()).toBeNull();
    });
  });

  it('clears the failure line when the next save starts', async () => {
    const held = gate();
    serveLayouts({ putStatus: 500 });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Save layout', '1 change'));
    await screen.findByText(FAILED);
    serveLayouts({ holdSave: held.promise });
    await user.click(control('Save layout', '1 change'));
    await waitFor(() => {
      expect(failure()).toBeNull();
    });
    held.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('clears the failure line when the mode ends', async () => {
    serveLayouts({ putStatus: 500 });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Save layout', '1 change'));
    await screen.findByText(FAILED);
    await user.click(control('Cancel', '1 change'));
    const dialog = await screen.findByRole('alertdialog', { name: DISCARD_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    await user.click(customizeButton());
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
    expect(failure()).toBeNull();
  });

  describe('after a 412', () => {
    const conflictOf = (): string => screen.getByTestId('conflict').textContent ?? '';
    const pendingOf = (): string => screen.getByTestId('pending').textContent ?? '';

    /** Customize mode with one change, saved once and answered with a 412. */
    async function conflicted(): Promise<{ user: User; served: ServedLayouts }> {
      const served = serveLayouts({ putStatus: 412 });
      const { user } = renderWithProviders(<ScreenUnderTest extra={<ConflictProbe />} />);
      await startCustomizing(user);
      expect(conflictOf()).toBe('none');
      await edit(user);
      await user.click(control('Save layout', '1 change'));
      await waitFor(() => {
        expect(conflictOf()).toBe('personal');
      });
      return { user, served };
    }

    it('opens the conflict state, keeps the draft and the mode, and shows no failure line', async () => {
      await conflicted();
      expect(pendingOf()).toBe('personal');
      expect(stateOf()).toBe('customize 1');
      expect(failure()).toBeNull();
    });

    it('never sends a second save: the next Save asks the question again, even when the draft was edited', async () => {
      const { user, served } = await conflicted();
      expect(served.puts).toHaveLength(1);
      await user.click(control('Save layout', '1 change'));
      expect(conflictOf()).toBe('personal');
      await user.click(screen.getByRole('button', { name: 'Dismiss dialog' }));
      expect(conflictOf()).toBe('none');
      expect(pendingOf()).toBe('personal');
      await user.click(within(box()).getByRole('button', { name: 'Edit' }));
      await user.click(control('Save layout', '2 changes'));
      await waitFor(() => {
        expect(conflictOf()).toBe('personal');
      });
      expect(served.puts).toHaveLength(1);
      expect(stateOf()).toBe('customize 2');
    });

    it('saves again once the conflict is resolved', async () => {
      const { user, served } = await conflicted();
      await user.click(screen.getByRole('button', { name: 'Resolve conflict' }));
      expect(conflictOf()).toBe('none');
      expect(pendingOf()).toBe('none');
      await user.click(control('Save layout', '1 change'));
      await waitFor(() => {
        expect(served.puts).toHaveLength(2);
      });
    });

    it('forgets the conflict when the mode ends', async () => {
      const { user } = await conflicted();
      await user.click(control('Cancel', '1 change'));
      const dialog = await screen.findByRole('alertdialog', { name: DISCARD_TITLE });
      await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
      await waitFor(() => {
        expect(stateOf()).toBe('view 0');
      });
      expect(conflictOf()).toBe('none');
      expect(pendingOf()).toBe('none');
    });
  });

  it('gives the scope line the full text as a title, since it may be cut short', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(within(bar('No changes')).getByText(SCOPE)).toHaveAttribute('title', SCOPE);
  });

  it('gives the differs line the full text as a title too', async () => {
    personalOverTeam();
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(within(bar('No changes')).getByText(DIFFERS)).toHaveAttribute('title', DIFFERS);
  });

  describe('keeping the focus clear of the bar', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('reserves the height of the bar at the bottom of the scrolling page while the mode is on', async () => {
      const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        return { height: this.dataset.slot === 'layout-save-bar' ? 56 : 0 } as DOMRect;
      });
      const { user } = renderWithProviders(<ScreenUnderTest />);
      await loaded();
      expect(document.documentElement.style.scrollPaddingBottom).toBe('');
      await startCustomizing(user);
      expect(document.documentElement.style.scrollPaddingBottom).toBe('56px');
      await user.click(customizeButton());
      await waitFor(() => {
        expect(document.documentElement.style.scrollPaddingBottom).toBe('');
      });
      measure.mockRestore();
    });
  });

  it('is not rendered when the screen asks for no save bar', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest saveBar="none" />);
    await startCustomizing(user);
    expect(screen.queryByRole('group', { name: COUNT })).toBeNull();
  });
});

describe('Reset to default', () => {
  it('is disabled while the draft is the default', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(isDisabled(control('Reset to default', 'No changes'))).toBe(true);
  });

  it('replaces the draft with the default and announces it, saving nothing', async () => {
    const served = serveLayouts();
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user, 2);
    await user.click(control('Reset to default', '2 changes'));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
    expect(polite()).toHaveTextContent('Layout reset to the default. Save to keep it.');
    expect(isDisabled(control('Reset to default', 'No changes'))).toBe(true);
    expect(served.puts).toEqual([]);
    expect(served.deletes).toEqual([]);
  });

  it('goes back to the team default, not the built-in layout, when one exists', async () => {
    const served = personalOverTeam();
    const { user } = renderWithProviders(<ScreenUnderTest extra={<DraftProbe />} />);
    await startCustomizing(user);
    expect(screen.getByTestId('draft')).not.toHaveTextContent('cards t1 numbers');
    expect(isDisabled(control('Reset to default', 'No changes'))).toBe(false);
    await user.click(control('Reset to default', 'No changes'));
    await waitFor(() => {
      expect(screen.getByTestId('draft').textContent).toBe('cards t1 numbers ');
    });
    expect(stateOf()).toMatch(/^customize [1-9]/);
    expect(served.puts).toEqual([]);
    expect(served.deletes).toEqual([]);
  });
});

describe('Cancel', () => {
  it('leaves at once when there are no changes', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await user.click(control('Cancel', 'No changes'));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks first when there are changes, and Keep editing stays', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Cancel', '1 change'));
    const dialog = await screen.findByRole('alertdialog', { name: DISCARD_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(stateOf()).toBe('customize 1');
  });

  it('drops the changes when they are discarded', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Cancel', '1 change'));
    const dialog = await screen.findByRole('alertdialog', { name: DISCARD_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });
});

describe('Undo and Redo', () => {
  it('follow canUndo and canRedo', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(isDisabled(control('Undo', 'No changes'))).toBe(true);
    expect(isDisabled(control('Redo', 'No changes'))).toBe(true);
    await edit(user);
    expect(isDisabled(control('Undo', '1 change'))).toBe(false);
    expect(isDisabled(control('Redo', '1 change'))).toBe(true);
    await user.click(control('Undo', '1 change'));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
    expect(polite()).toHaveTextContent('Change undone');
    expect(isDisabled(control('Redo', 'No changes'))).toBe(false);
    await user.click(control('Redo', 'No changes'));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 1');
    });
  });

  it('name their keys for assistive technology', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(control('Undo', 'No changes')).toHaveAttribute('aria-keyshortcuts');
    expect(control('Redo', 'No changes')).toHaveAttribute('aria-keyshortcuts');
  });
});

describe('while a save is under way', () => {
  it('disables every control, gives Save its loading state and ignores clicks', async () => {
    const held = gate();
    serveLayouts({ holdSave: held.promise });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    await edit(user);
    await user.click(control('Save layout', '1 change'));
    await waitFor(() => {
      expect(control('Save layout', '1 change')).toHaveAttribute('aria-busy', 'true');
    });
    for (const name of ['Undo', 'Redo', 'Reset to default', 'Cancel']) {
      expect(isDisabled(control(name, '1 change')), `${name} is disabled`).toBe(true);
    }
    await user.click(control('Cancel', '1 change'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(stateOf()).toBe('customize 1');
    held.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });
});
