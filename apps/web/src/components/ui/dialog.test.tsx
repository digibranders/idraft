import { act, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader, type DialogSize } from './dialog';
import { Field, FieldLabel } from './field';
import { Input } from './input';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const DISCARD = {
  title: 'Discard unsaved changes?',
  description: 'Your changes to this competitor will be lost.',
  keepEditingLabel: 'Keep editing',
  discardLabel: 'Discard changes',
};

function AddCompetitor({
  dirty,
  size = 'md',
  withField = true,
  onClose,
}: {
  dirty?: boolean;
  size?: DialogSize;
  withField?: boolean;
  onClose?: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const change = (next: boolean): void => {
    setOpen(next);
    if (!next) onClose?.();
  };
  const body = (
    <>
      <DialogHeader
        title="Add competitor"
        description="Tracked for SEO rank and AI share of voice."
        closeLabel="Close"
      />
      <DialogBody>
        {withField ? (
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input />
          </Field>
        ) : (
          <p>Nothing to fill in.</p>
        )}
      </DialogBody>
      <DialogFooter
        secondary={
          <DialogClose>
            <Button>Cancel</Button>
          </DialogClose>
        }
        primary={<Button variant="primary">Add competitor</Button>}
      />
    </>
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      {dirty === undefined ? (
        <Dialog open={open} onOpenChange={change} size={size}>
          {body}
        </Dialog>
      ) : (
        <Dialog open={open} onOpenChange={change} size={size} dirty={dirty} discard={DISCARD}>
          {body}
        </Dialog>
      )}
    </>
  );
}
const openDialog = async (user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return screen.findByRole('dialog', { name: 'Add competitor' });
};

describe('Dialog', () => {
  it('is a modal dialog named by its title and described by its description', async () => {
    const { user } = renderWithProviders(<AddCompetitor />);
    const dialog = await openDialog(user);
    expect(dialog).toHaveAccessibleDescription('Tracked for SEO rank and AI share of voice.');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Add competitor' })).toHaveClass('type-section-title');
  });

  it('puts focus in the first field when it opens', async () => {
    const { user } = renderWithProviders(<AddCompetitor />);
    const dialog = await openDialog(user);
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus());
  });

  it('starts on the Close button when it has no field', async () => {
    const { user } = renderWithProviders(<AddCompetitor withField={false} />);
    const dialog = await openDialog(user);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus());
  });

  // Base UI hides everything outside the dialog from assistive technology and sends Tab back in through
  // focus guards. The guards need animation frames, which jsdom does not run, so that Tab really stays
  // inside is checked in the browser. What can be checked here is that the page is out of reach.
  it('takes the rest of the page out of reach while it is open', async () => {
    const { user } = renderWithProviders(<AddCompetitor />);
    const opener = screen.getByRole('button', { name: 'Open' });
    expect(opener.closest('[inert], [aria-hidden="true"]')).toBeNull();
    await openDialog(user);
    expect(opener.closest('[inert], [aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it.each([
    ['Escape', async (user: ReturnType<typeof renderWithProviders>['user']) => user.keyboard('{Escape}')],
    [
      'the Close button',
      async (user: ReturnType<typeof renderWithProviders>['user']) =>
        user.click(screen.getByRole('button', { name: 'Close' })),
    ],
    [
      'Cancel',
      async (user: ReturnType<typeof renderWithProviders>['user']) =>
        user.click(screen.getByRole('button', { name: 'Cancel' })),
    ],
  ])('closes on %s and returns focus to what opened it', async (_way, act) => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<AddCompetitor onClose={onClose} />);
    await openDialog(user);
    await act(user);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus());
  });

  it('closes on a click on the scrim while it is clean', async () => {
    const { user, baseElement } = renderWithProviders(<AddCompetitor />);
    await openDialog(user);
    const scrim = baseElement.querySelector('[data-slot="dialog-scrim"]');
    await user.click(scrim as Element);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each([
    ['Escape', async (user: ReturnType<typeof renderWithProviders>['user']) => user.keyboard('{Escape}')],
    [
      'Cancel',
      async (user: ReturnType<typeof renderWithProviders>['user']) =>
        user.click(screen.getByRole('button', { name: 'Cancel' })),
    ],
  ])('asks before it closes on %s while it is dirty, and keeps editing on request', async (_way, act) => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<AddCompetitor dirty onClose={onClose} />);
    await openDialog(user);
    await act(user);
    const question = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(question).toHaveAccessibleDescription('Your changes to this competitor will be lost.');
    await waitFor(() => expect(within(question).getByRole('button', { name: 'Keep editing' })).toHaveFocus());
    await user.click(within(question).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Add competitor' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes a dirty dialog when the user chooses to discard', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<AddCompetitor dirty onClose={onClose} />);
    await openDialog(user);
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a click on the scrim while it is dirty: no question, nothing closes', async () => {
    const onClose = vi.fn();
    const { user, baseElement } = renderWithProviders(<AddCompetitor dirty onClose={onClose} />);
    await openDialog(user);
    const scrim = baseElement.querySelector('[data-slot="dialog-scrim"]');
    await user.click(scrim as Element);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Add competitor' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes without asking when the guard is on but nothing has changed', async () => {
    const { user } = renderWithProviders(<AddCompetitor dirty={false} />);
    await openDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('takes focus where the caller says, and skips a field that is not shown', async () => {
    function Steps({ chosen }: { chosen: boolean }): ReactElement {
      const target = useRef<HTMLButtonElement>(null);
      return (
        <Dialog open onOpenChange={vi.fn()} size="md" {...(chosen ? { initialFocus: target } : {})}>
          <DialogHeader title="Import keywords" closeLabel="Close" />
          <DialogBody>
            <div hidden>
              <input aria-label="Hidden step" />
            </div>
            <input aria-label="File name" />
          </DialogBody>
          <DialogFooter primary={<Button ref={target}>Continue</Button>} />
        </Dialog>
      );
    }
    const first = renderWithProviders(<Steps chosen={false} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'File name' })).toHaveFocus());
    first.unmount();
    renderWithProviders(<Steps chosen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus());
  });

  it('does not reopen with the question when it was closed from outside while asking', async () => {
    function Controlled(): ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Dialog open={open} onOpenChange={setOpen} size="sm" dirty discard={DISCARD}>
            <DialogHeader title="Rename" closeLabel="Close" />
            <DialogBody>
              <input aria-label="Name" />
            </DialogBody>
            <DialogFooter primary={<Button>Save</Button>} />
          </Dialog>
          <button type="button" data-testid="toggle" onClick={() => setOpen((current) => !current)}>
            Toggle
          </button>
        </>
      );
    }
    const { user } = renderWithProviders(<Controlled />);
    await screen.findByRole('dialog', { name: 'Rename' });
    await user.keyboard('{Escape}');
    await screen.findByRole('alertdialog');
    const toggle = screen.getByTestId('toggle');
    act(() => toggle.click());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => toggle.click());
    await screen.findByRole('dialog', { name: 'Rename' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('has a Close button without a tooltip, so the first Escape closes the dialog', async () => {
    const { user } = renderWithProviders(<AddCompetitor withField={false} />);
    const dialog = await openDialog(user);
    const close = within(dialog).getByRole('button', { name: 'Close' });
    await waitFor(() => expect(close).toHaveFocus());
    expect(close).not.toHaveAttribute('data-base-ui-tooltip-trigger');
    expect(document.querySelector('[data-slot="tooltip"]')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lets a popup opened inside it come out above it, and passes attributes and the body ref on', async () => {
    const bodyRef = { current: null as HTMLDivElement | null };
    renderWithProviders(
      <Dialog open onOpenChange={vi.fn()} size="sm" id="rename" aria-describedby="hint">
        <DialogHeader title="Rename" closeLabel="Close" />
        <DialogBody ref={bodyRef}>
          <input aria-label="Name" />
        </DialogBody>
        <DialogFooter primary={<Button>Save</Button>} />
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Rename' });
    expect(dialog).toHaveAttribute('id', 'rename');
    expect(dialog.closest('[data-base-ui-portal]')).toHaveClass('[--z-dropdown:var(--z-dialog)]');
    expect(bodyRef.current).toBe(dialog.querySelector('[data-slot="dialog-body"]'));
  });

  it.each<[DialogSize, string]>([
    ['sm', 'sm:w-dialog-sm'],
    ['md', 'sm:w-dialog-md'],
    ['lg', 'sm:w-dialog-lg'],
  ])('size %s is %s, and fills the screen below 640 px', async (size, widthClass) => {
    const { user } = renderWithProviders(<AddCompetitor size={size} />);
    const dialog = await openDialog(user);
    expect(dialog).toHaveClass(widthClass, 'inset-0', 'sm:inset-auto', 'sm:rounded-xl', 'z-(--z-dialog)');
    expect(dialog).toHaveClass('bg-surface-elevated', 'shadow-dialog');
  });

  it('lays out header, scrolling body and footer with the documented padding', async () => {
    const { user } = renderWithProviders(<AddCompetitor />);
    const dialog = await openDialog(user);
    expect(dialog.querySelector('[data-slot="dialog-header"]')).toHaveClass('px-6', 'pt-6', 'pb-4');
    expect(dialog.querySelector('[data-slot="dialog-body"]')).toHaveClass('px-6', 'pb-6', 'overflow-y-auto', 'peer');
    const footer = dialog.querySelector('[data-slot="dialog-footer"]');
    expect(footer).toHaveClass('px-6', 'py-4', 'border-t', 'border-transparent', 'peer-data-cut:border-border-subtle');
    const buttons = within(footer as HTMLElement).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Add competitor']);
  });

  it('marks the body as cut off while content is below the fold, which is when the footer shows its border', async () => {
    const heights = { scrollHeight: 900, clientHeight: 300 };
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => heights.scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => heights.clientHeight);
    const { user } = renderWithProviders(<AddCompetitor />);
    const dialog = await openDialog(user);
    const body = dialog.querySelector('[data-slot="dialog-body"]') as HTMLElement;
    expect(body).toHaveAttribute('data-cut');
    vi.spyOn(body, 'scrollTop', 'get').mockReturnValue(600);
    body.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(body).not.toHaveAttribute('data-cut'));
    vi.restoreAllMocks();
  });

  it('has no accessibility violations while open, and with the question above it', async () => {
    const { user, baseElement } = renderWithProviders(<AddCompetitor dirty />);
    await openDialog(user);
    expect(await axe(baseElement)).toHaveNoViolations();
    await user.keyboard('{Escape}');
    await screen.findByRole('alertdialog');
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
