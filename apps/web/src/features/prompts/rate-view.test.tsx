import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useRateWords } from './rate-view';
import type { RateFigure } from '@/lib/rates/strip-model';
import { renderWithProviders } from '@/test/render';

const figure = (overrides: Partial<RateFigure>): RateFigure => ({
  state: 'ok',
  value: 0.83,
  answers: 6,
  successes: 5,
  prompts: 2,
  reason: null,
  ...overrides,
});

/** The words of one figure, read as the strip reads them. */
function Words({ rate }: { rate: RateFigure }) {
  const words = useRateWords();
  return (
    <p>
      <span data-testid="text">{words.text(rate)}</span>
      <span data-testid="inline">{words.inline(rate)}</span>
      <span data-testid="basis">{words.basis(rate) ?? 'none'}</span>
      <span data-testid="reason">{words.reason(rate) ?? 'none'}</span>
    </p>
  );
}
const wordsOf = (rate: RateFigure): Record<'text' | 'basis' | 'reason', string | null> => {
  renderWithProviders(<Words rate={rate} />);
  return {
    text: screen.getByTestId('text').textContent,
    basis: screen.getByTestId('basis').textContent,
    reason: screen.getByTestId('reason').textContent,
  };
};

describe('useRateWords', () => {
  it('writes a rate as a percent with the answers behind it', () => {
    expect(wordsOf(figure({}))).toEqual({ text: '83%', basis: '5 of 6 answers', reason: 'none' });
  });

  it('writes a share of voice with the answers it is over, and no count of its own', () => {
    expect(wordsOf(figure({ value: 0.27, answers: 31, successes: null }))).toEqual({
      text: '27%',
      basis: '31 answers',
      reason: 'none',
    });
  });

  it('writes a rate under the minimum as its answers, never as a percent', () => {
    expect(wordsOf(figure({ state: 'insufficient', value: null, answers: 3, successes: 1 }))).toEqual({
      text: '3 answers',
      basis: '1 of 3 answers',
      reason: 'none',
    });
  });

  it('writes a rate inside a line as a percent, or as the state it is in rather than a bare count of answers', () => {
    const inline = (rate: RateFigure): string | null => {
      const { unmount } = renderWithProviders(<Words rate={rate} />);
      const text = screen.getByTestId('inline').textContent;
      unmount();
      return text;
    };
    expect(inline(figure({}))).toBe('83%');
    expect(inline(figure({ state: 'insufficient', value: null, answers: 3, successes: 1 }))).toBe(
      'too few answers (3)',
    );
    expect(inline(figure({ state: 'none', value: null, answers: 0, successes: null, reason: 'noAnswers' }))).toBe(
      'n/a',
    );
  });

  it('writes n/a with the reason the tables give when there is no rate', () => {
    expect(wordsOf(figure({ state: 'none', value: null, answers: 0, successes: null, reason: 'noneValid' }))).toEqual({
      text: 'n/a',
      basis: 'none',
      reason: 'None valid',
    });
  });
});
