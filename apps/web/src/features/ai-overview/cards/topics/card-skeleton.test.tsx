import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PendingSkeleton } from '../pending-skeleton';
import { topicSkeleton } from './card-skeleton';

const BLOCK_CLASS = { 140: 'h-35', 180: 'h-45', 240: 'h-60', 280: 'h-70' } as const;

describe('topicSkeleton', () => {
  it.each([140, 180, 240, 280] as const)(
    'has a title line and a block of the frame height (h-35, h-45, h-60, h-70) for %s',
    (height) => {
      const Skeleton = topicSkeleton(height);
      const { container } = render(<Skeleton />);
      const parts = container.querySelectorAll('[data-slot="skeleton"]');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toHaveClass('h-5');
      expect(parts[1]).toHaveClass(BLOCK_CLASS[height]);
    },
  );

  it('is hidden from assistive technology', () => {
    const Skeleton = topicSkeleton(280);
    const { container } = render(<Skeleton />);
    for (const part of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(part).toHaveAttribute('aria-hidden', 'true');
    }
    expect(container).toHaveTextContent('');
  });

  it('its outer box equals the pending skeleton for 180', () => {
    const Skeleton = topicSkeleton(180);
    const topic = render(<Skeleton />).container.innerHTML;
    const pending = render(<PendingSkeleton />).container.innerHTML;
    expect(topic).toBe(pending);
  });
});
