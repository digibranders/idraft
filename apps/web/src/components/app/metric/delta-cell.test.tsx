import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeltaCell } from './delta-cell';
import { formatPointsDelta, type MetricDeltaInput, type Polarity } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const POLARITIES: readonly Polarity[] = ['higher_is_better', 'lower_is_better', 'neutral'];
const TIP_TEXT = { selector: '[data-slot="tooltip"] span' } as const;

function input(overrides: Partial<MetricDeltaInput> = {}): MetricDeltaInput {
  return { value: 0.053, unit: 'points', polarity: 'higher_is_better', isDetectable: true, ...overrides };
}

describe('DeltaCell', () => {
  it('shows n/a, never 0, without a comparison', () => {
    for (const value of [null, Number.NaN]) {
      const { container, unmount } = renderWithProviders(<DeltaCell input={input({ value })} />);
      expect(screen.getByText('n/a')).toHaveClass('text-foreground-tertiary');
      expect(container).not.toHaveTextContent('0');
      unmount();
    }
  });

  it('never colours a change that is not detectable', () => {
    for (const polarity of POLARITIES) {
      for (const isDetectable of [false, null]) {
        const { unmount } = renderWithProviders(<DeltaCell input={input({ polarity, isDetectable })} />);
        const shown = screen.getByText(formatPointsDelta(0.053));
        expect(shown).toHaveClass('text-foreground-secondary');
        expect(shown).not.toHaveClass('text-positive-text');
        expect(shown).not.toHaveClass('text-negative-text');
        unmount();
      }
    }
  });

  it('colours a detectable change by its polarity, in the table type', () => {
    const up = renderWithProviders(<DeltaCell input={input()} />);
    expect(screen.getByText('+5.3 pts')).toHaveClass('text-positive-text');
    expect(up.container.firstElementChild).toHaveClass('type-table', 'num');
    up.unmount();
    renderWithProviders(<DeltaCell input={input({ polarity: 'lower_is_better' })} />);
    expect(screen.getByText('+5.3 pts')).toHaveClass('text-negative-text');
  });

  it('carries its own tooltip, which a keyboard reaches, unless the table carries it', async () => {
    const own = renderWithProviders(
      <DeltaCell input={input({ isDetectable: false })} tip={{ previousText: 'Previous 29.0%' }} />,
    );
    await own.user.tab();
    expect(await screen.findByText('Previous 29.0%. Within normal variation', TIP_TEXT)).toBeInTheDocument();
    own.unmount();

    const table = renderWithProviders(<DeltaCell input={input()} tip={false} />);
    await table.user.tab();
    expect(document.body).toHaveFocus();
    expect(table.container.querySelector('[tabindex]')).toBeNull();
  });

  it('shows the version boundary icon with its text', async () => {
    const { container, user } = renderWithProviders(
      <DeltaCell input={input()} boundaryText="Prompt version 3 starts here" />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.tab();
    expect(await screen.findByText(/Version boundary: Prompt version 3 starts here/, TIP_TEXT)).toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleDescription(
      expect.stringContaining('Version boundary: Prompt version 3 starts here'),
    );
  });

  it('keeps the boundary text for a screen reader when the table carries the tooltip', () => {
    renderWithProviders(<DeltaCell input={input()} tip={false} boundaryText="Prompt version 3 starts here" />);
    expect(screen.getByText('Version boundary: Prompt version 3 starts here')).toHaveClass('sr-only');
  });

  it('shows no boundary icon without boundary text', () => {
    const { container } = renderWithProviders(<DeltaCell input={input()} boundaryText={null} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('has no accessibility violations with a value, without one, and with a boundary', async () => {
    const value = renderWithProviders(<DeltaCell input={input()} />);
    expect(await axe(value.container)).toHaveNoViolations();
    value.unmount();
    const empty = renderWithProviders(<DeltaCell input={input({ value: null })} />);
    expect(await axe(empty.container)).toHaveNoViolations();
    empty.unmount();
    const boundary = renderWithProviders(<DeltaCell input={input()} boundaryText="Prompt version 3 starts here" />);
    expect(await axe(boundary.container)).toHaveNoViolations();
  });
});
