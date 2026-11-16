import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeltaIcon } from './delta-icon';
import type { MetricDeltaInput } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function input(overrides: Partial<MetricDeltaInput> = {}): MetricDeltaInput {
  return { value: 0.053, unit: 'points', polarity: 'higher_is_better', isDetectable: true, ...overrides };
}

const iconOf = (container: HTMLElement): HTMLElement => {
  const icon = container.querySelector<HTMLElement>('[data-slot="delta-icon"]');
  if (icon === null) throw new Error('No icon is drawn');
  return icon;
};

describe('DeltaIcon', () => {
  it('colours a detectable rise green and says it in words', () => {
    const { container } = renderWithProviders(<DeltaIcon input={input()} />);
    const icon = iconOf(container);
    expect(icon).toHaveAttribute('data-direction', 'up');
    expect(icon).toHaveClass('text-positive-text');
    expect(icon).toHaveTextContent(/detectable/);
  });

  it('colours a detectable fall red', () => {
    const { container } = renderWithProviders(<DeltaIcon input={input({ value: -0.053 })} />);
    expect(iconOf(container)).toHaveAttribute('data-direction', 'down');
    expect(iconOf(container)).toHaveClass('text-negative-text');
  });

  it('never colours a change that is not detectable, and keeps the direction', () => {
    for (const isDetectable of [false, null]) {
      const { container, unmount } = renderWithProviders(<DeltaIcon input={input({ isDetectable })} />);
      const icon = iconOf(container);
      expect(icon).toHaveAttribute('data-direction', 'up');
      expect(icon).toHaveClass('text-foreground-secondary');
      unmount();
    }
  });

  it('draws a dash for a change of nothing', () => {
    const { container } = renderWithProviders(<DeltaIcon input={input({ value: 0, isDetectable: false })} />);
    expect(iconOf(container)).toHaveAttribute('data-direction', 'flat');
  });

  it('draws nothing without a comparison: an unknown change is not a flat one', () => {
    const { container } = renderWithProviders(<DeltaIcon input={input({ value: null })} />);
    expect(container.querySelector('[data-slot="delta-icon"]')).toBeNull();
  });

  it('names the interim test only when asked, under the slot it is given', () => {
    const paired = renderWithProviders(<DeltaIcon input={input()} />);
    expect(iconOf(paired.container).textContent).not.toMatch(/provisional/);
    paired.unmount();
    const { container } = renderWithProviders(<DeltaIcon input={input()} test="interim" slot="custom" />);
    expect(container.querySelector('[data-slot="custom"]')?.textContent).toMatch(/provisional/);
  });

  it('is a tab stop only when it carries a tooltip, and has no violations', async () => {
    const { container } = renderWithProviders(<DeltaIcon input={input()} tip="Previous 20%" />);
    const icon = iconOf(container);
    expect(icon).toHaveAttribute('tabindex', '0');
    expect(icon).toHaveAccessibleDescription('Previous 20%');
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getAllByText(/detectable/).length).toBeGreaterThan(0);
  });

  it('adds no tab stop without a tip', () => {
    const { container } = renderWithProviders(<DeltaIcon input={input()} />);
    expect(iconOf(container)).not.toHaveAttribute('tabindex');
  });
});
