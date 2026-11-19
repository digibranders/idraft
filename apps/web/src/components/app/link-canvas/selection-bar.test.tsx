import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelectionBar } from './selection-bar';
import { renderWithProviders } from '@/test/render';

describe('SelectionBar', () => {
  it('says how many cards are selected and offers set tier, show their links and clear', async () => {
    const handlers = { onSetTier: vi.fn(), onShowLinks: vi.fn(), onClear: vi.fn() };
    const { user } = renderWithProviders(<SelectionBar count={3} {...handlers} />);
    expect(screen.getByText('3 cards selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set tier' }));
    await user.click(screen.getByRole('button', { name: 'Show their links' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(handlers.onSetTier).toHaveBeenCalled();
    expect(handlers.onShowLinks).toHaveBeenCalled();
    expect(handlers.onClear).toHaveBeenCalled();
  });

  it('uses the singular for one card', () => {
    renderWithProviders(<SelectionBar count={1} onSetTier={vi.fn()} onShowLinks={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('1 card selected')).toBeInTheDocument();
  });

  it('has no Set tier for a person who cannot write', () => {
    renderWithProviders(<SelectionBar count={2} onShowLinks={vi.fn()} onClear={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Set tier' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show their links' })).toBeInTheDocument();
  });
});
