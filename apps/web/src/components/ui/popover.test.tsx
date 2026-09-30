import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { Popover } from './popover';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const popup = (): HTMLElement | null => document.querySelector('[data-slot="popover"]');

describe('Popover', () => {
  it('is closed until its trigger is pressed, and the trigger says whether it is open', async () => {
    const { user } = renderWithProviders(
      <Popover trigger={<Button>Density</Button>} title="Table density">
        <button type="button">Compact</button>
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: 'Density' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(popup()).toBeNull();
    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Table density' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', popup()?.id);
  });

  it('moves focus into the popup, and Escape closes it and returns focus to the trigger', async () => {
    const { user } = renderWithProviders(
      <Popover trigger={<Button>Density</Button>} title="Table density">
        <button type="button">Compact</button>
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: 'Density' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compact' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup()).toBeNull());
    expect(screen.getByRole('button', { name: 'Density' })).toHaveFocus();
  });

  it('is not modal: the page stays reachable, and a click outside closes it', async () => {
    const { user } = renderWithProviders(
      <>
        <Popover trigger={<Button>Density</Button>} title="Table density">
          <button type="button">Compact</button>
        </Popover>
        <button type="button">Elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Density' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal', 'true');
    // Nothing outside is hidden or inert, which is what lets Tab and the pointer leave the popover
    const outside = screen.getByRole('button', { name: 'Elsewhere' });
    expect(outside.closest('[inert], [aria-hidden="true"]')).toBeNull();
    await user.click(outside);
    await waitFor(() => expect(popup()).toBeNull());
  });

  it('can be controlled', async () => {
    const onOpenChange = vi.fn();
    const { user } = renderWithProviders(
      <Popover trigger={<Button>Density</Button>} title="Table density" open onOpenChange={onOpenChange}>
        <p>Rows are 40 px tall.</p>
      </Popover>,
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('is an elevated surface between 280 and 360 px wide, with 12 px padding for lists and 16 px for text', async () => {
    const { user, rerender } = renderWithProviders(
      <Popover trigger={<Button>Density</Button>} title="Table density">
        <p>Body</p>
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: 'Density' }));
    await screen.findByRole('dialog');
    expect(popup()).toHaveClass(
      'rounded-lg',
      'border',
      'bg-surface-elevated',
      'shadow-popover',
      'min-w-popover-min',
      'max-w-popover-max',
    );
    expect(popup()?.parentElement).toHaveClass('z-(--z-dropdown)');
    expect(screen.getByText('Body').parentElement).toHaveClass('p-3');
    rerender(
      <Popover trigger={<Button>Density</Button>} title="Table density" padding="text" width="max">
        <p>Body</p>
      </Popover>,
    );
    expect(screen.getByText('Body').parentElement).toHaveClass('p-4');
    expect(popup()).toHaveClass('w-popover-max');
  });

  it('keeps its footer outside the part that scrolls', async () => {
    const { user } = renderWithProviders(
      <Popover trigger={<Button>Columns</Button>} title="Columns" footer={<Button size="sm">Reset</Button>}>
        <p>Body</p>
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await screen.findByRole('dialog');
    const footer = screen.getByRole('button', { name: 'Reset' }).parentElement;
    expect(footer).toHaveClass('border-t', 'shrink-0');
    expect(footer?.closest('[data-slot="scroll-area"]')).toBeNull();
    expect(screen.getByText('Body').closest('[data-slot="scroll-area"]')).not.toBeNull();
  });

  it('takes its name from aria-label when it has no title, and passes attributes on', async () => {
    const { user } = renderWithProviders(
      <Popover trigger={<Button>Info</Button>} aria-label="How visibility is measured" id="method">
        <p>Body</p>
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: 'Info' }));
    expect(await screen.findByRole('dialog', { name: 'How visibility is measured' })).toHaveAttribute('id', 'method');
  });

  it('has no accessibility violations while open', async () => {
    const { user, baseElement } = renderWithProviders(
      <Popover trigger={<Button>Density</Button>} title="Table density">
        <button type="button">Compact</button>
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: 'Density' }));
    await screen.findByRole('dialog');
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
