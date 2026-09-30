import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog, DiscardChangesDialog, matchesConfirmation, type ConfirmDialogProps } from './alert-dialog';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function DeleteKeywords(props: Partial<ConfirmDialogProps> & { onClose?: () => void }): ReactElement {
  const { onClose, ...rest } = props;
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onClose?.();
        }}
        title="Delete 12 keywords?"
        description="Their rank history and SERP snapshots are deleted. Archive keeps the history instead."
        confirmLabel="Delete 12 keywords"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        {...rest}
      />
    </>
  );
}
const dialog = (): Promise<HTMLElement> => screen.findByRole('alertdialog', { name: 'Delete 12 keywords?' });

describe('ConfirmDialog', () => {
  it('is an alert dialog named by its title and described by what is lost', async () => {
    renderWithProviders(<DeleteKeywords />);
    expect(await dialog()).toHaveAccessibleDescription(
      'Their rank history and SERP snapshots are deleted. Archive keeps the history instead.',
    );
  });

  it('starts on Cancel and has no Close button', async () => {
    renderWithProviders(<DeleteKeywords />);
    const popup = await dialog();
    await waitFor(() => expect(within(popup).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(
      within(popup)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel', 'Delete 12 keywords']);
  });

  it('cancels on Escape and on Cancel, without running the action', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithProviders(<DeleteKeywords onConfirm={onConfirm} onClose={onClose} />);
    await dialog();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does nothing on a click on the scrim', async () => {
    const onClose = vi.fn();
    const { user, baseElement } = renderWithProviders(<DeleteKeywords onClose={onClose} />);
    await dialog();
    const scrim = baseElement.querySelector('[data-slot="dialog-scrim"]');
    await user.click(scrim as Element);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('runs the action with the solid destructive button, shows it working, and closes when it is done', async () => {
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = renderWithProviders(<DeleteKeywords onConfirm={onConfirm} />);
    const popup = await dialog();
    const confirm = within(popup).getByRole('button', { name: 'Delete 12 keywords' });
    expect(confirm).toHaveClass('bg-negative-button', 'text-negative-button-foreground');
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(within(popup).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('stays open when the action fails, and shows why', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('network')));
    const { user, rerender } = renderWithProviders(<DeleteKeywords onConfirm={onConfirm} />);
    const popup = await dialog();
    await user.click(within(popup).getByRole('button', { name: 'Delete 12 keywords' }));
    await waitFor(() =>
      expect(within(popup).getByRole('button', { name: 'Delete 12 keywords' })).not.toHaveAttribute('aria-busy'),
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    rerender(<DeleteKeywords onConfirm={onConfirm} error="The keywords could not be deleted. Try again." />);
    expect(within(popup).getByRole('alert')).toHaveTextContent('The keywords could not be deleted. Try again.');
  });

  it('asks for the name before an irreversible deletion, and enables the button only on an exact match', async () => {
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(
      <DeleteKeywords
        onConfirm={onConfirm}
        typedConfirmation={{
          expected: 'acme-crm',
          label: (
            <>
              Type <code>acme-crm</code> to confirm
            </>
          ),
        }}
      />,
    );
    const popup = await dialog();
    const confirm = within(popup).getByRole('button', { name: 'Delete 12 keywords' });
    const field = within(popup).getByRole('textbox', { name: 'Type acme-crm to confirm' });
    expect(confirm).toBeDisabled();
    await user.type(field, 'Acme-crm');
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, ' acme-crm ');
    expect(confirm).toBeEnabled();
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveClass('type-mono');
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cannot be cancelled with Escape while the action runs', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn(() => new Promise<void>(() => undefined));
    const { user } = renderWithProviders(<DeleteKeywords onConfirm={onConfirm} onClose={onClose} />);
    const popup = await dialog();
    await user.click(within(popup).getByRole('button', { name: 'Delete 12 keywords' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('forgets what was typed when it is opened again', async () => {
    const { user } = renderWithProviders(
      <DeleteKeywords typedConfirmation={{ expected: 'acme-crm', label: 'Type acme-crm to confirm' }} />,
    );
    await user.type(within(await dialog()).getByRole('textbox'), 'acme');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(within(await dialog()).getByRole('textbox')).toHaveValue('');
  });

  it('lets a popup opened inside it come out above it', async () => {
    renderWithProviders(<DeleteKeywords />);
    expect((await dialog()).closest('[data-base-ui-portal]')).toHaveClass('[--z-dropdown:var(--z-dialog)]');
  });

  it('uses the primary button for a confirmation that destroys nothing', async () => {
    renderWithProviders(<DeleteKeywords tone="neutral" confirmLabel="Stay signed in" />);
    expect(within(await dialog()).getByRole('button', { name: 'Stay signed in' })).toHaveClass('bg-primary');
  });

  it('stays a centered 400 px card at every width', async () => {
    renderWithProviders(<DeleteKeywords />);
    const popup = await dialog();
    expect(popup).toHaveClass('rounded-xl', 'bg-surface-elevated', 'shadow-dialog', 'z-(--z-dialog)', 'left-1/2');
    expect(popup.className).toContain('w-[min(var(--container-dialog-sm),calc(100vw-2rem))]');
  });

  it('has no accessibility violations', async () => {
    const { baseElement } = renderWithProviders(
      <DeleteKeywords
        typedConfirmation={{ expected: 'acme-crm', label: 'Type acme-crm to confirm' }}
        error="Try again."
      />,
    );
    await dialog();
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});

describe('matchesConfirmation', () => {
  it.each([
    ['acme-crm', true],
    ['  acme-crm ', true],
    ['Acme-crm', false],
    ['acme', false],
    ['', false],
  ])('%j is %s', (typed, expected) => {
    expect(matchesConfirmation(typed, 'acme-crm')).toBe(expected);
  });
});

describe('DiscardChangesDialog', () => {
  const COPY = {
    title: 'Discard unsaved changes?',
    description: 'Your changes to Budgets will be lost.',
    keepEditingLabel: 'Keep editing',
    discardLabel: 'Discard changes',
  };

  it('starts on Keep editing, and Escape keeps editing too', async () => {
    const onKeepEditing = vi.fn();
    const onDiscard = vi.fn();
    const { user } = renderWithProviders(
      <DiscardChangesDialog open {...COPY} onKeepEditing={onKeepEditing} onDiscard={onDiscard} />,
    );
    const popup = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(popup).toHaveAccessibleDescription('Your changes to Budgets will be lost.');
    await waitFor(() => expect(within(popup).getByRole('button', { name: 'Keep editing' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('discards with the solid destructive button', async () => {
    const onDiscard = vi.fn();
    const { user } = renderWithProviders(
      <DiscardChangesDialog open {...COPY} onKeepEditing={vi.fn()} onDiscard={onDiscard} />,
    );
    const button = await screen.findByRole('button', { name: 'Discard changes' });
    expect(button).toHaveClass('bg-negative-button');
    await user.click(button);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations', async () => {
    const { baseElement } = renderWithProviders(
      <DiscardChangesDialog open {...COPY} onKeepEditing={vi.fn()} onDiscard={vi.fn()} />,
    );
    await screen.findByRole('alertdialog');
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
