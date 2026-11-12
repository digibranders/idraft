import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Delta } from './delta';
import { formatPointsDelta, type MetricDeltaInput, type Polarity } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const POLARITIES: readonly Polarity[] = ['higher_is_better', 'lower_is_better', 'neutral'];
const TIP_TEXT = { selector: '[data-slot="tooltip"] span' } as const;

function input(overrides: Partial<MetricDeltaInput> = {}): MetricDeltaInput {
  return { value: 0.053, unit: 'points', polarity: 'higher_is_better', isDetectable: true, ...overrides };
}

describe('Delta', () => {
  it('never colours a change that is not detectable', () => {
    for (const polarity of POLARITIES) {
      for (const value of [0.053, -0.053, 0]) {
        for (const isDetectable of [false, null]) {
          const { unmount } = renderWithProviders(
            <Delta input={input({ value, polarity, isDetectable })} tip={false} />,
          );
          const shown = screen.getByText(formatPointsDelta(value));
          expect(shown).toHaveClass('text-foreground-secondary');
          expect(shown).not.toHaveClass('text-positive-text');
          expect(shown).not.toHaveClass('text-negative-text');
          unmount();
        }
      }
    }
  });

  it('colours a detectable change by its polarity', () => {
    const cases = [
      { value: 0.053, polarity: 'higher_is_better', tone: 'text-positive-text' },
      { value: 0.053, polarity: 'lower_is_better', tone: 'text-negative-text' },
      { value: -0.053, polarity: 'higher_is_better', tone: 'text-negative-text' },
      { value: -0.053, polarity: 'lower_is_better', tone: 'text-positive-text' },
      { value: 0.053, polarity: 'neutral', tone: 'text-foreground-secondary' },
      { value: -0.053, polarity: 'neutral', tone: 'text-foreground-secondary' },
      { value: 0, polarity: 'higher_is_better', tone: 'text-foreground-secondary' },
      { value: 0, polarity: 'lower_is_better', tone: 'text-foreground-secondary' },
    ] as const;
    for (const { value, polarity, tone } of cases) {
      const { unmount } = renderWithProviders(<Delta input={input({ value, polarity })} tip={false} />);
      expect(screen.getByText(formatPointsDelta(value))).toHaveClass(tone);
      unmount();
    }
  });

  it('renders nothing when there is no comparison', () => {
    for (const value of [null, Number.NaN]) {
      const { container, unmount } = renderWithProviders(<Delta input={input({ value })} />);
      // The providers add their live regions, which are empty: the delta adds no text and no box
      expect(container).toHaveTextContent(/^$/);
      expect(container.querySelector('.num, [tabindex]')).toBeNull();
      unmount();
    }
  });

  it('says the change and its detectability to a screen reader', () => {
    renderWithProviders(<Delta input={input()} tip={false} />);
    expect(screen.getByText('+5.3 pts')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('up 5.3 pts, detectable')).toHaveClass('sr-only');
  });

  it('says within normal variation to a screen reader when the change is not detectable', () => {
    renderWithProviders(<Delta input={input({ isDetectable: false })} tip={false} />);
    expect(screen.getByText('up 5.3 pts, within normal variation')).toHaveClass('sr-only');
  });

  it('claims nothing about detectability when there is no test for the metric', () => {
    renderWithProviders(<Delta input={input({ isDetectable: null })} tip={false} />);
    expect(screen.getByText('up 5.3 pts')).toHaveClass('sr-only');
  });

  it('says within normal variation in the tooltip with the interval, and the previous value first', async () => {
    const { user } = renderWithProviders(
      <Delta
        input={input({ value: 0.018, isDetectable: false })}
        tip={{ previousText: 'Previous 29.0%', intervalText: '95% interval -1.1 to +4.6 pts' }}
      />,
    );
    await user.tab();
    const text = 'Previous 29.0%. Within normal variation: 95% interval -1.1 to +4.6 pts';
    expect(await screen.findByText(text, TIP_TEXT)).toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleDescription(text);
  });

  it('says what makes a change detectable in the tooltip, with the method', async () => {
    const { user } = renderWithProviders(<Delta input={input()} tip={{ method: 'paired, 243 prompts' }} />);
    await user.tab();
    expect(
      await screen.findByText(
        'Detectable change: the 95% interval of the change excludes 0 (paired, 243 prompts)',
        TIP_TEXT,
      ),
    ).toBeInTheDocument();
  });

  it('labels the interim test, and only when asked to', async () => {
    const interim = renderWithProviders(<Delta input={input()} test="interim" />);
    await interim.user.tab();
    expect(await screen.findByText(/Interim test: unpaired, may understate uncertainty/, TIP_TEXT)).toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleDescription(
      expect.stringContaining('Interim test: unpaired, may understate uncertainty'),
    );
    interim.unmount();

    const paired = renderWithProviders(<Delta input={input()} />);
    await paired.user.tab();
    expect(await screen.findByText(/Detectable change/, TIP_TEXT)).toBeInTheDocument();
    expect(document.activeElement).not.toHaveAccessibleDescription(expect.stringContaining('Interim'));
  });

  it('claims nothing in the interim test when there is no detectability to qualify', () => {
    const { container } = renderWithProviders(<Delta input={input({ isDetectable: null })} test="interim" />);
    expect(container.querySelector('[tabindex]')).toBeNull();
  });

  it('leaves the tooltip to its container when tip is false', async () => {
    const { container, user } = renderWithProviders(<Delta input={input()} test="interim" tip={false} />);
    await user.tab();
    expect(document.body).toHaveFocus();
    expect(container.querySelector('[aria-describedby]')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
  });

  it('is a tab stop only when it has something to say', () => {
    const silent = renderWithProviders(<Delta input={input({ isDetectable: null })} />);
    expect(silent.container.querySelector('[tabindex]')).toBeNull();
    silent.unmount();
    const withPrevious = renderWithProviders(
      <Delta input={input({ isDetectable: null })} tip={{ previousText: 'Previous 29.0%' }} />,
    );
    expect(withPrevious.container.querySelector('[tabindex="0"]')).not.toBeNull();
  });

  it('has no accessibility violations when detectable, not detectable or interim', async () => {
    const detectable = renderWithProviders(<Delta input={input()} />);
    expect(await axe(detectable.container)).toHaveNoViolations();
    detectable.unmount();
    const within = renderWithProviders(<Delta input={input({ isDetectable: false })} />);
    expect(await axe(within.container)).toHaveNoViolations();
    within.unmount();
    const interim = renderWithProviders(<Delta input={input()} test="interim" size="sm" />);
    expect(await axe(interim.container)).toHaveNoViolations();
  });
});
