import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TrendIcon } from './trend-icon';

describe('TrendIcon', () => {
  it('draws up in green only when the change is detectable, and says it in words', () => {
    const { container, rerender } = render(
      <TrendIcon
        input={{ value: 0.2, unit: 'points', polarity: 'higher_is_better', isDetectable: true }}
        spoken="Up 20.0 pts, detectable change"
      />,
    );
    expect(container.firstElementChild?.className).toContain('text-positive-text');
    expect(screen.getByText('Up 20.0 pts, detectable change')).toHaveClass('sr-only');
    rerender(
      <TrendIcon
        input={{ value: 0.02, unit: 'points', polarity: 'higher_is_better', isDetectable: false }}
        spoken="Up 2.0 pts, within normal variation"
      />,
    );
    expect(container.firstElementChild?.className).toContain('text-foreground-secondary');
  });

  it('draws a flat change as a minus', () => {
    const { container } = render(
      <TrendIcon
        input={{ value: 0.0001, unit: 'points', polarity: 'higher_is_better', isDetectable: false }}
        spoken="No change"
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.firstElementChild?.getAttribute('data-direction')).toBe('flat');
  });

  it('draws a detectable fall in red', () => {
    const { container } = render(
      <TrendIcon
        input={{ value: -0.2, unit: 'points', polarity: 'higher_is_better', isDetectable: true }}
        spoken="Down 20.0 pts, detectable change"
      />,
    );
    expect(container.firstElementChild?.getAttribute('data-direction')).toBe('down');
    expect(container.firstElementChild?.className).toContain('text-negative-text');
  });
});
