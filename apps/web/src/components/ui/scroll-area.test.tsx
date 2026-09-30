import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScrollArea } from './scroll-area';
import { axe } from '@/test/axe';

/** jsdom does not lay out, so the heights a browser would measure are given here. */
function overflowing(): void {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(960);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  // Base UI skips the measurement of an element without a width
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
}
const viewport = (container: HTMLElement): Element => {
  const node = container.querySelector('[data-slot="scroll-area"] > *');
  if (!node) throw new Error('No viewport rendered');
  return node;
};

describe('ScrollArea', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a named region that takes keyboard focus while it overflows, for content with nothing focusable', async () => {
    overflowing();
    render(
      <ScrollArea maxHeight="popover" label="Notifications">
        <p>Twelve items</p>
      </ScrollArea>,
    );
    const region = screen.getByRole('region', { name: 'Notifications' });
    await waitFor(() => expect(region).toHaveAttribute('tabindex', '0'));
  });

  it('is not a tab stop when everything fits', () => {
    render(
      <ScrollArea maxHeight="popover" label="Notifications">
        <p>Two items</p>
      </ScrollArea>,
    );
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('tabindex', '-1');
  });

  it('adds no tab stop and no region without a label, even while it overflows', async () => {
    overflowing();
    const { container } = render(
      <ScrollArea maxHeight="menu">
        <button type="button">First item</button>
      </ScrollArea>,
    );
    // Wait for the measurement that would have made a named region a tab stop
    await waitFor(() => expect(container.querySelector('[data-has-overflow-y]')).not.toBeNull());
    expect(screen.queryByRole('region')).toBeNull();
    expect(viewport(container)).toHaveAttribute('tabindex', '-1');
    expect(container.querySelector('[tabindex="0"]')).toBeNull();
  });

  it.each([
    ['popover', 'max-h-100'],
    ['menu', 'max-h-100'],
    ['command', 'max-h-120'],
    ['fill', 'h-full'],
  ] as const)('%s is limited to %s', (maxHeight, heightClass) => {
    const { container } = render(
      <ScrollArea maxHeight={maxHeight} label="List">
        <p>Content</p>
      </ScrollArea>,
    );
    expect(viewport(container)).toHaveClass(heightClass);
  });

  it('passes other attributes on to its root', () => {
    const { container } = render(
      <ScrollArea maxHeight="fill" id="results" className="border-t">
        <p>Content</p>
      </ScrollArea>,
    );
    const root = container.querySelector('[data-slot="scroll-area"]');
    expect(root).toHaveAttribute('id', 'results');
    expect(root).toHaveClass('border-t', 'h-full');
  });

  it('has no accessibility violations, overflowing or not', async () => {
    const still = render(
      <ScrollArea maxHeight="popover" label="Notifications">
        <p>Two items</p>
      </ScrollArea>,
    );
    expect(await axe(still.container)).toHaveNoViolations();
    still.unmount();
    overflowing();
    const { container } = render(
      <ScrollArea maxHeight="popover" label="Notifications">
        <p>Twelve items</p>
      </ScrollArea>,
    );
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('tabindex', '0'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
