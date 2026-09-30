import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SaveBar } from './save-bar';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const LABELS = { discardLabel: 'Discard', saveLabel: 'Save changes' };

describe('SaveBar', () => {
  it('is not rendered while the form has no unsaved changes', () => {
    const { container } = renderWithProviders(
      <SaveBar visible={false} summary="0 unsaved changes" onDiscard={vi.fn()} {...LABELS} />,
    );
    expect(container.querySelector('[data-slot="save-bar"]')).toBeNull();
  });

  it('shows the number of changes, Discard and Save changes', () => {
    renderWithProviders(<SaveBar visible summary="2 unsaved changes" onDiscard={vi.fn()} {...LABELS} />);
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveClass('bg-transparent', 'h-control');
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveClass('bg-primary', 'h-control');
  });

  it('submits the form it is in when Save changes is pressed', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const { user } = renderWithProviders(
      <form ref={(form) => form?.addEventListener('submit', onSubmit)}>
        <SaveBar visible summary="1 unsaved change" onDiscard={vi.fn()} {...LABELS} />
      </form>,
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAttribute('type', 'submit');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('can submit a form it is rendered outside of', () => {
    renderWithProviders(<SaveBar visible summary="1 unsaved change" onDiscard={vi.fn()} form="budget" {...LABELS} />);
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveAttribute('form', 'budget');
  });

  it('discards at once, without submitting', async () => {
    const onDiscard = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const { user } = renderWithProviders(
      <form ref={(form) => form?.addEventListener('submit', onSubmit)}>
        <SaveBar visible summary="1 unsaved change" onDiscard={onDiscard} {...LABELS} />
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the save in progress and takes no second submit or discard', async () => {
    const onDiscard = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const { user } = renderWithProviders(
      <form ref={(form) => form?.addEventListener('submit', onSubmit)}>
        <SaveBar visible saving summary="1 unsaved change" onDiscard={onDiscard} {...LABELS} />
      </form>,
    );
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toHaveAttribute('aria-busy', 'true');
    await user.click(save);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('shows what the changes would cost when the form has a price', () => {
    renderWithProviders(
      <SaveBar
        visible
        summary="2 unsaved changes"
        estimate="+$42.10 per month, estimate"
        onDiscard={vi.fn()}
        {...LABELS}
      />,
    );
    expect(screen.getByText('+$42.10 per month, estimate')).toHaveClass('type-meta', 'num');
  });

  it('sticks to the bottom at 56 px or more, above the content, with its contents on the form column', () => {
    const { container } = renderWithProviders(
      <SaveBar visible summary="2 unsaved changes" onDiscard={vi.fn()} id="bar" {...LABELS} />,
    );
    const bar = container.querySelector('[data-slot="save-bar"]');
    expect(bar).toHaveClass('sticky', 'bottom-0', 'z-(--z-sticky)', 'min-h-save-bar', 'border-t', 'bg-surface', 'px-5');
    expect(bar).toHaveAttribute('id', 'bar');
    expect(bar?.firstElementChild).toHaveClass('max-w-form', 'justify-between');
  });

  it('is a group named by its summary', () => {
    renderWithProviders(<SaveBar visible summary="2 unsaved changes" onDiscard={vi.fn()} {...LABELS} />);
    expect(screen.getByRole('group', { name: '2 unsaved changes' })).toBeInTheDocument();
  });

  it('hands focus to the first field of the form when it leaves with focus on one of its buttons', async () => {
    function Form(): ReactElement {
      const [dirty, setDirty] = useState(true);
      return (
        <form aria-label="Budget">
          <input type="hidden" name="id" />
          <input aria-label="Monthly limit" />
          <SaveBar visible={dirty} summary="1 unsaved change" onDiscard={() => setDirty(false)} {...LABELS} />
        </form>
      );
    }
    const { user } = renderWithProviders(<Form />);
    screen.getByRole('button', { name: 'Discard' }).focus();
    await user.keyboard(' ');
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Monthly limit' })).toHaveFocus();
  });

  it('leaves focus alone when it leaves while focus is elsewhere', async () => {
    function Form(): ReactElement {
      const [dirty, setDirty] = useState(true);
      return (
        <form aria-label="Budget">
          <input aria-label="Monthly limit" />
          <button type="button" onClick={() => setDirty(false)}>
            Revert outside
          </button>
          <SaveBar visible={dirty} summary="1 unsaved change" onDiscard={vi.fn()} {...LABELS} />
        </form>
      );
    }
    const { user } = renderWithProviders(<Form />);
    screen.getByRole('button', { name: 'Discard' }).focus();
    await user.click(screen.getByRole('button', { name: 'Revert outside' }));
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revert outside' })).toHaveFocus();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <form aria-label="Budget">
        <SaveBar visible summary="2 unsaved changes" onDiscard={vi.fn()} {...LABELS} />
      </form>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
