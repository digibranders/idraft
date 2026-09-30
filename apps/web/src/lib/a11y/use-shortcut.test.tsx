import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { useShortcut } from './use-shortcut';
import { Dialog, DialogHeader } from '@/components/ui/dialog';
import { renderWithProviders } from '@/test/render';

function Page({ onKey, enabled = true }: { onKey: () => void; enabled?: boolean }): React.ReactNode {
  useShortcut('?', onKey, { kind: 'single-key', enabled });
  return (
    <>
      <button type="button">Somewhere</button>
      <input aria-label="Search" />
    </>
  );
}

describe('useShortcut', () => {
  it('fires on its key outside fields', async () => {
    const onKey = vi.fn();
    const user = userEvent.setup();
    render(<Page onKey={onKey} />);
    await user.click(screen.getByRole('button', { name: 'Somewhere' }));
    await user.keyboard('?');
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('leaves the key to a text field, and to a modifier combination', async () => {
    const onKey = vi.fn();
    const user = userEvent.setup();
    render(<Page onKey={onKey} />);
    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.keyboard('?');
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('?');
    await user.click(screen.getByRole('button', { name: 'Somewhere' }));
    await user.keyboard('{Control>}?{/Control}');
    expect(onKey).not.toHaveBeenCalled();
  });

  it('does nothing while a dialog is open, or when single-key shortcuts are off', async () => {
    const onKey = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<Page onKey={onKey} enabled={false} />);
    await user.keyboard('?');
    rerender(
      <>
        <Page onKey={onKey} />
        <Dialog open onOpenChange={vi.fn()} size="sm">
          <DialogHeader title="Keyboard shortcuts" closeLabel="Close" />
        </Dialog>
      </>,
    );
    await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    await user.keyboard('?');
    expect(onKey).not.toHaveBeenCalled();
  });

  it('dismisses from anywhere but an open popup, a text field included', async () => {
    const onEscape = vi.fn();
    function Overlay(): React.ReactNode {
      useShortcut('Escape', onEscape, { kind: 'dismiss' });
      return <input aria-label="Search" />;
    }
    const user = userEvent.setup();
    render(<Overlay />);
    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
