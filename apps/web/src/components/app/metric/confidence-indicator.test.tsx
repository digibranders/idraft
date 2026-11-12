import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfidenceIndicator } from './confidence-indicator';
import { axe } from '@/test/axe';

const LABEL = '95% interval 29% to 39%';

describe('ConfidenceIndicator', () => {
  it('says the interval as text, with a name for assistive technology', async () => {
    const { container } = render(
      <ConfidenceIndicator estimate={0.34} low={0.29} high={0.39} form="text" label={LABEL} />,
    );
    const indicator = screen.getByRole('img', { name: LABEL });
    expect(indicator).toHaveTextContent('29% to 39%');
    expect(container.querySelector('[data-slot="confidence-bar"]')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('draws the interval on a 1 px axis with no filled track, and a point at the estimate', () => {
    const { container } = render(
      <ConfidenceIndicator estimate={0.5} low={0.25} high={0.75} form="text-and-bar" label={LABEL} />,
    );
    const bar = container.querySelector('[data-slot="confidence-bar"]');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar).toHaveClass('h-3', 'w-12');
    expect(bar?.querySelector('.bg-border-strong')).not.toBeNull();
    expect(bar?.querySelector('[class*="bg-surface"]')).toBeNull();
    expect(bar?.querySelector('.bg-foreground-secondary')).toHaveStyle({ left: '25%', width: '50%' });
    expect(bar?.querySelector('.bg-foreground')).toHaveStyle({ left: '50%' });
    expect(screen.getByRole('img', { name: LABEL })).toHaveTextContent('25% to 75%');
  });

  it('draws the bar alone, named for assistive technology, when the form is bar', () => {
    const { container } = render(
      <ConfidenceIndicator estimate={0.34} low={0.29} high={0.39} form="bar" label={LABEL} />,
    );
    expect(screen.getByRole('img', { name: LABEL })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="confidence-bar"]')).not.toBeNull();
    expect(container).not.toHaveTextContent('29%');
  });

  it('puts the interval on the shared scale it is given, and keeps it inside the axis', () => {
    const { container } = render(
      <ConfidenceIndicator estimate={0.3} low={0.2} high={0.8} scaleMax={0.5} form="text-and-bar" label={LABEL} />,
    );
    const bar = container.querySelector('[data-slot="confidence-bar"]');
    expect(bar?.querySelector('.bg-foreground-secondary')).toHaveStyle({ left: '40%', width: '60%' });
    expect(bar?.querySelector('.bg-foreground')).toHaveStyle({ left: '60%' });
  });

  it('says n/a, and draws no bar, when there is no interval', () => {
    const { container } = render(
      <ConfidenceIndicator estimate={null} low={null} high={null} form="text-and-bar" label={LABEL} />,
    );
    expect(screen.getByText('n/a')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="confidence-bar"]')).toBeNull();
  });
});
