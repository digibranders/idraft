import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CanvasHelp } from './canvas-help';
import { renderWithProviders } from '@/test/render';

describe('CanvasHelp', () => {
  it('lists the gestures and keys', () => {
    renderWithProviders(<CanvasHelp />);
    const region = screen.getByRole('region', { name: 'Legend and controls' });
    expect(within(region).getByText('Shift and drag')).toBeInTheDocument();
    expect(within(region).getByText('Select several cards')).toBeInTheDocument();
    expect(within(region).getByText('Plus and minus')).toBeInTheDocument();
    expect(within(region).getByText('Centre on the focus page')).toBeInTheDocument();
    expect(within(region).getByText('Clear the selection, or go back to the focus page')).toBeInTheDocument();
  });

  it('draws the six line styles and the boxes', () => {
    renderWithProviders(<CanvasHelp />);
    const lines = screen.getByRole('list', { name: 'Lines' });
    expect(within(lines).getAllByRole('listitem')).toHaveLength(6);
    expect(within(screen.getByRole('list', { name: 'Boxes' })).getByText('Selected')).toBeInTheDocument();
  });

  it('never mentions equity', () => {
    renderWithProviders(<CanvasHelp />);
    expect(screen.getByRole('region', { name: 'Legend and controls' }).textContent.toLowerCase()).not.toContain(
      'equity',
    );
  });
});
