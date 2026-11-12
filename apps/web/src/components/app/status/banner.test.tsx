import { describe, expect, it } from 'vitest';

import { Banner } from './banner';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const banner = (container: HTMLElement): Element => {
  const found = container.querySelector('[data-slot="banner"]');
  if (found === null) throw new Error('Banner did not render');
  return found;
};

describe('Banner variants', () => {
  it('sits under the inspector header without a radius', () => {
    const { container } = renderWithProviders(<Banner tone="info" placement="inspector" message="Cited in 3 of 8." />);
    const el = banner(container);
    expect(el).toHaveClass('border-b', 'px-4', 'py-2');
    expect(el).not.toHaveClass('rounded-md');
    expect(el).not.toHaveClass('border');
  });

  it('states a neutral fact without a warning colour', () => {
    const { container } = renderWithProviders(
      <Banner tone="neutral" placement="inspector" message="Not cited in any of the 8 answers." />,
    );
    const el = banner(container);
    expect(el).toHaveClass('border-border-subtle', 'bg-surface-subtle');
    expect(el.className).not.toMatch(/warning|negative|info/);
    const icon = el.querySelector('svg');
    expect(icon).toHaveClass('text-foreground-tertiary');
    expect(icon?.getAttribute('class') ?? '').not.toMatch(/text-(warning|negative|info)/);
  });

  it('announces a neutral banner politely when it appears', () => {
    const { container } = renderWithProviders(
      <Banner tone="neutral" placement="inspector" message="Not cited in any of the 8 answers." live />,
    );
    expect(banner(container)).toHaveAttribute('role', 'status');
  });

  it('keeps the page and region variants as they were', () => {
    const { container, rerender } = renderWithProviders(<Banner tone="info" placement="page" message="Page." />);
    expect(banner(container)).toHaveClass('border-b', 'px-5', 'py-2', 'border-info-border', 'bg-info-subtle');
    expect(banner(container)).not.toHaveClass('rounded-md');
    rerender(<Banner tone="warning" placement="region" message="Region." />);
    expect(banner(container)).toHaveClass('rounded-md', 'border', 'px-3', 'py-2', 'border-warning-border');
    expect(banner(container)).not.toHaveClass('border-b');
  });

  it('has no axe violations for cited and not cited inside an inspector-like region', async () => {
    const { container } = renderWithProviders(
      <section aria-label="Answer inspector">
        <Banner
          tone="info"
          placement="inspector"
          lead="Cited"
          message="Cited in 3 of 8 answers; last answer Nov 11, 09:05; 13 pages cited"
        />
        <Banner tone="neutral" placement="inspector" message="Not cited in any of the 8 answers" />
      </section>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
