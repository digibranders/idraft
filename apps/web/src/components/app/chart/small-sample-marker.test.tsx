import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SmallSampleMarker } from './small-sample-marker';
import { MIN_OBSERVATIONS } from '@/lib/stats';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('SmallSampleMarker', () => {
  it('says the answers in the quiet text of a figure or a tooltip', async () => {
    const { container } = renderWithProviders(<SmallSampleMarker answers={3} form="text" />);
    const text = screen.getByText('3 answers');
    expect(text).toHaveClass('text-foreground-tertiary', 'type-meta');
    expect(text).not.toHaveClass('bg-insufficient');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('counts one answer in the singular', () => {
    renderWithProviders(<SmallSampleMarker answers={1} form="text" />);
    expect(screen.getByText('1 answer')).toBeInTheDocument();
  });

  it('is the hatched pill in a cell, with what is missing in a tooltip', async () => {
    const { container } = renderWithProviders(<SmallSampleMarker answers={3} form="cell" />);
    const pill = screen.getByText('3 answers');
    expect(pill).toHaveClass('bg-insufficient');
    expect(pill).toHaveAccessibleDescription(
      `Too few valid answers for a rate: 3 of the ${String(MIN_OBSERVATIONS)} it needs.`,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('leaves the tooltip to the table cell that carries it', () => {
    renderWithProviders(<SmallSampleMarker answers={3} form="cell" tip={false} />);
    expect(screen.getByText('3 answers')).not.toHaveAccessibleDescription();
  });
});
