import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EngineBadge } from './engine-badge';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('EngineBadge', () => {
  it('reads as the engine name with or without its logo', async () => {
    const { container, rerender } = renderWithProviders(<EngineBadge engine="gemini_web" name="Gemini" />);
    expect(screen.getByText('Gemini')).toHaveAttribute('data-slot', 'badge');
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    rerender(<EngineBadge engine="gemini_web" name="Gemini" logo />);
    expect(screen.getByRole('presentation')).toHaveAttribute('alt', '');
    expect(screen.getByText('Gemini').closest('[data-slot="badge"]')).toHaveTextContent('Gemini');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the name alone when the engine has no mark, even with logo set', () => {
    renderWithProviders(<EngineBadge engine="perplexity_web" name="Perplexity" logo />);
    expect(screen.getByText('Perplexity')).toBeInTheDocument();
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  });
});
