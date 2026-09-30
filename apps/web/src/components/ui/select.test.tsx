import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Field, FieldLabel } from './field';
import { Select, type SelectOption } from './select';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

type Workload = 'rank' | 'ai' | 'audit' | 'backlinks';
const OPTIONS: readonly SelectOption<Workload>[] = [
  { value: 'rank', label: 'Rank checks', group: 'Collection' },
  { value: 'ai', label: 'AI visibility', group: 'Collection', description: 'Prompts asked of each engine' },
  { value: 'audit', label: 'Site audit', group: 'Analysis' },
  { value: 'backlinks', label: 'Backlinks', group: 'Analysis', disabled: true },
];

function Controlled({ onChange }: { onChange?: (value: Workload) => void }): ReactElement {
  const [value, setValue] = useState<Workload | null>(null);
  return (
    <Field>
      <FieldLabel>Workload</FieldLabel>
      <Select
        value={value}
        placeholder="Select a workload"
        options={OPTIONS}
        onValueChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </Field>
  );
}
const trigger = (): HTMLElement => screen.getByRole('combobox', { name: 'Workload' });

describe('Select', () => {
  it('is a closed select-only combobox that shows its placeholder', () => {
    renderWithProviders(<Controlled />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveTextContent('Select a workload');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('looks like a text input with a chevron', () => {
    renderWithProviders(<Controlled />);
    expect(trigger()).toHaveClass(
      'h-control',
      'px-3',
      'rounded-md',
      'border',
      'bg-surface',
      'type-input-touch',
      'md:type-body',
      'justify-between',
    );
    expect(trigger().querySelector('svg')).toHaveClass('size-icon-sm');
  });

  it('opens on click, lists the options under their groups, and takes the one that is clicked', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    await user.click(trigger());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    expect(within(list).getByRole('group', { name: 'Collection' })).toBeInTheDocument();
    expect(within(list).getByText('Prompts asked of each engine')).toHaveClass('type-meta');
    await user.click(within(list).getByRole('option', { name: /Site audit/ }));
    expect(onChange).toHaveBeenCalledWith('audit');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger()).toHaveTextContent('Site audit');
  });

  const highlighted = (): string | null | undefined =>
    document.querySelector('[role="option"][data-highlighted]')?.textContent;
  /** Opens the list from the keyboard and waits until it has taken focus, which is when it handles keys. */
  const openWithKeyboard = async (user: ReturnType<typeof renderWithProviders>['user']): Promise<void> => {
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    await waitFor(() => expect(highlighted()).toBe('Rank checks'));
    await waitFor(() =>
      expect(document.querySelector('[data-slot="select-popup"]')?.contains(document.activeElement)).toBe(true),
    );
  };

  it('works from the keyboard: arrows open and move, Enter chooses, and focus returns to the trigger', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    await openWithKeyboard(user);
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(highlighted()).toContain('AI visibility'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('ai'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(trigger()).toHaveTextContent('AI visibility');
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('jumps to an option by its first letters', async () => {
    const { user } = renderWithProviders(<Controlled />);
    await openWithKeyboard(user);
    await user.keyboard('si');
    await waitFor(() => expect(highlighted()).toBe('Site audit'));
  });

  it('closes on Escape without a change', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    await user.click(trigger());
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent('Select a workload');
  });

  it('does not offer an option that is disabled', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<Controlled onChange={onChange} />);
    await user.click(trigger());
    const option = await screen.findByRole('option', { name: /Backlinks/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    await user.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the chosen option in the open list', async () => {
    const { user } = renderWithProviders(
      <Select
        aria-label="Workload"
        value="ai"
        placeholder="Select a workload"
        options={OPTIONS}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('AI visibility');
    await user.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: /AI visibility/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('cannot be opened when disabled', async () => {
    const { user } = renderWithProviders(
      <Select
        aria-label="Workload"
        value={null}
        placeholder="Select a workload"
        options={OPTIONS}
        onValueChange={vi.fn()}
        disabled
      />,
    );
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('shows the invalid state of its field, passes attributes on and hands over its trigger', () => {
    const ref = { current: null as HTMLButtonElement | null };
    renderWithProviders(
      <Field invalid>
        <FieldLabel>Workload</FieldLabel>
        <Select
          value={null}
          placeholder="Select a workload"
          options={OPTIONS}
          onValueChange={vi.fn()}
          size="sm"
          id="workload"
          ref={ref}
        />
      </Field>,
    );
    expect(trigger()).toHaveAttribute('data-invalid');
    expect(trigger()).toHaveAttribute('id', 'workload');
    expect(trigger()).toHaveClass('h-control-sm', 'data-invalid:border-negative-solid');
    expect(ref.current).toBe(trigger());
  });

  it('has no accessibility violations, closed or open', async () => {
    const { user, baseElement } = renderWithProviders(<Controlled />);
    expect(await axe(baseElement)).toHaveNoViolations();
    await user.click(trigger());
    await screen.findByRole('listbox');
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
