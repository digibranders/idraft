import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FreshnessIndicator, type FreshnessIndicatorProps } from './freshness-indicator';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NOW = new Date('2026-11-12T12:00:00Z');

const BASE: FreshnessIndicatorProps = {
  state: 'fresh',
  lastAnswerAt: '2026-11-12T09:10:00Z',
  timeZone: 'UTC',
  text: 'AI updated Nov 12, 09:10',
  badgeText: 'Last answer 6 days ago',
  tooltip: (relative) => `Newest answer ${relative}`,
};

describe('FreshnessIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fresh shows the time in type-meta and the relative time in a tooltip', () => {
    renderWithProviders(<FreshnessIndicator {...BASE} />);
    const trigger = screen.getByRole('button', { name: 'AI updated Nov 12, 09:10' });
    expect(trigger).toHaveClass('type-meta');
    expect(trigger).toHaveAccessibleDescription('Newest answer 2h ago');
    expect(screen.queryByText('Last answer 6 days ago')).not.toBeInTheDocument();
  });

  it('the time element has a datetime', () => {
    renderWithProviders(<FreshnessIndicator {...BASE} />);
    const time = screen.getByText('AI updated Nov 12, 09:10');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-11-12T09:10:00Z');
  });

  it('stale shows the warning badge with words and an icon, beside the time', async () => {
    const { container } = renderWithProviders(<FreshnessIndicator {...BASE} state="stale" />);
    const badge = screen.getByText('Last answer 6 days ago');
    expect(badge).toHaveClass('bg-warning-subtle', 'text-warning-text', 'h-badge');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('AI updated Nov 12, 09:10')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('none says there is no answer yet, with no time element and no button', () => {
    const { container } = renderWithProviders(
      <FreshnessIndicator {...BASE} state="none" lastAnswerAt={null} text="No AI answers yet" />,
    );
    expect(screen.getByText('No AI answers yet')).toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('refreshes the relative text every minute without announcing it', () => {
    renderWithProviders(<FreshnessIndicator {...BASE} />);
    const trigger = screen.getByRole('button', { name: 'AI updated Nov 12, 09:10' });
    expect(trigger).toHaveAccessibleDescription('Newest answer 2h ago');
    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(trigger).toHaveAccessibleDescription('Newest answer 3h ago');
    // The app's own live regions are elsewhere in the tree; the indicator has none of its own
    const indicator = trigger.parentElement as HTMLElement;
    expect(indicator.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(indicator).not.toHaveAttribute('aria-live');
  });
});
