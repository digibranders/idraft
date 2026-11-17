import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LaneChips, LayoutSwitch } from './layout-controls';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const TIERS = [
  { position: 1, code: 'T1', name: 'Money pages' },
  { position: 2, code: 'T2', name: 'Support pages' },
  { position: 3, code: 'T3', name: 'Content pages' },
];

describe('LayoutSwitch', () => {
  it('offers By step and By tier, and says which one is chosen', () => {
    renderWithProviders(<LayoutSwitch value="tier" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'By tier' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'By step' })).not.toBeChecked();
  });

  it('reports the layout that was chosen', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<LayoutSwitch value="step" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'By tier' }));
    expect(onChange).toHaveBeenCalledWith('tier');
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<LayoutSwitch value="step" onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('LaneChips', () => {
  it('has one chip for each tier and for Untiered, pressed while its lane is shown', () => {
    renderWithProviders(<LaneChips tiers={TIERS} hidden={new Set([2])} focusPosition={1} onToggle={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Tiers shown' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'T3 Content pages' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'T2 Support pages' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Untiered' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says that the Untiered lane shows only when an untiered page is in view', () => {
    renderWithProviders(<LaneChips tiers={TIERS} hidden={new Set()} focusPosition={1} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Untiered' })).toHaveAccessibleDescription(
      'The Untiered lane shows only when an untiered page is in view',
    );
  });

  it('reports the position of the tier that was pressed, and 99 for Untiered', async () => {
    const onToggle = vi.fn();
    const { user } = renderWithProviders(
      <LaneChips tiers={TIERS} hidden={new Set()} focusPosition={1} onToggle={onToggle} />,
    );
    await user.click(screen.getByRole('button', { name: 'T3 Content pages' }));
    expect(onToggle).toHaveBeenLastCalledWith(3);
    await user.click(screen.getByRole('button', { name: 'Untiered' }));
    expect(onToggle).toHaveBeenLastCalledWith(99);
  });

  it('keeps the lane of the focus page on: its chip is pressed, disabled and says why', async () => {
    const onToggle = vi.fn();
    const { user } = renderWithProviders(
      <LaneChips tiers={TIERS} hidden={new Set([1])} focusPosition={1} onToggle={onToggle} />,
    );
    const chip = screen.getByRole('button', { name: 'T1 Money pages' });
    expect(chip).toBeDisabled();
    // A lane that is off in the address still shows for the focus page
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveAccessibleDescription('The lane of the focus page stays on');
    await user.click(chip);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(
      <LaneChips tiers={TIERS} hidden={new Set([2])} focusPosition={1} onToggle={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
