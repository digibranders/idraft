import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RefetchBar } from './refetch-bar';
import { renderWithProviders } from '@/test/render';

const bar = (container: HTMLElement): HTMLElement | null => container.querySelector('[data-slot="refetch-bar"]');

describe('RefetchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is shown after 150 ms of refetching and not before', () => {
    const { container } = renderWithProviders(<RefetchBar active position="under-filter-bar" />);
    expect(bar(container)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(bar(container)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(bar(container)).not.toBeNull();
  });

  it('never shows for a refetch that is over within 150 ms', () => {
    const { container, rerender } = renderWithProviders(<RefetchBar active position="under-filter-bar" />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(<RefetchBar active={false} position="under-filter-bar" />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(bar(container)).toBeNull();
  });

  it('is hidden again when the refetch is done', () => {
    const { container, rerender } = renderWithProviders(<RefetchBar active position="under-filter-bar" />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bar(container)).not.toBeNull();
    rerender(<RefetchBar active={false} position="under-filter-bar" />);
    expect(bar(container)).toBeNull();
  });

  it('is a static 2 px bar in the primary colour, hidden from assistive technology', () => {
    const { container } = renderWithProviders(<RefetchBar active position="under-section-heading" />);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const shown = bar(container);
    expect(shown).toHaveAttribute('aria-hidden', 'true');
    expect(shown).toHaveClass('h-0.5', 'bg-primary');
    expect(shown?.className).not.toMatch(/animate-|transition/);
  });
});
