import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { ComparedModeProvider, useShownMode } from './compared-window';
import { renderWithProviders } from '@/test/render';

function Mode(): ReactElement {
  return <p>{useShownMode()}</p>;
}

describe('useShownMode', () => {
  it('is what the rows on screen were read with, not the address that has just changed', () => {
    // The address says last year; the rows held while the new read loads are of the period before
    renderWithProviders(
      <ComparedModeProvider value="previous">
        <Mode />
      </ComparedModeProvider>,
      { searchParams: 'cmp=year' },
    );
    expect(screen.getByText('previous')).toBeInTheDocument();
  });

  it('is the address own mode where no page holds rows', () => {
    renderWithProviders(<Mode />, { searchParams: 'cmp=year' });
    expect(screen.getByText('year')).toBeInTheDocument();
    renderWithProviders(<Mode />);
    expect(screen.getByText('previous')).toBeInTheDocument();
  });
});
