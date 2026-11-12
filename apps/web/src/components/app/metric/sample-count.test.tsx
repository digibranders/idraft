import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SampleCount, type SampleNoun } from './sample-count';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NOUNS: ReadonlyArray<{ noun: SampleNoun; shown: string }> = [
  { noun: 'observations', shown: 'obs' },
  { noun: 'answers', shown: 'answers' },
  { noun: 'checks', shown: 'checks' },
  { noun: 'prompts', shown: 'prompts' },
  { noun: 'keywords', shown: 'keywords' },
];

describe('SampleCount', () => {
  it.each(NOUNS)('always names the noun: $noun', ({ noun, shown }) => {
    const { container } = renderWithProviders(<SampleCount k={612} n={1296} noun={noun} />);
    expect(container).toHaveTextContent(`612 of 1,296 ${shown}`);
  });

  it('reads obs as observations to a screen reader', () => {
    renderWithProviders(<SampleCount k={612} n={1296} noun="observations" />);
    expect(screen.getByText('obs')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('observations')).toHaveClass('sr-only');
  });

  it('shows n/a, never 0, for an unknown count', () => {
    for (const props of [
      { k: null, n: 1296, form: 'k-of-n' },
      { k: 612, n: null, form: 'k-of-n' },
      { k: null, n: null, form: 'k-of-n' },
      { k: null, n: null, form: 'n-only' },
    ] as const) {
      const { container, unmount } = renderWithProviders(<SampleCount {...props} noun="prompts" />);
      expect(container).toHaveTextContent(/^n\/a$/);
      unmount();
    }
  });

  it('counts the n-only form in the plural, and the one in the singular', () => {
    const { container, rerender } = renderWithProviders(<SampleCount k={null} n={250} noun="prompts" form="n-only" />);
    expect(container).toHaveTextContent('250 prompts');
    rerender(<SampleCount k={null} n={1} noun="prompts" form="n-only" />);
    expect(container).toHaveTextContent('1 prompt');
    expect(container).not.toHaveTextContent('1 prompts');
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<SampleCount k={612} n={1296} noun="observations" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
