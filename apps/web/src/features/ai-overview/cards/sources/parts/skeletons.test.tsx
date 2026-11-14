import { describe, expect, it } from 'vitest';

import { SOURCE_SKELETON_HEIGHTS, SOURCE_SKELETONS } from './skeletons';
import { renderWithProviders } from '@/test/render';

/** The frame height of each card of the family (WP-37 plan section 1): the skeleton must be as tall. */
const FRAME_HEIGHTS = {
  'sources.top_domains': 280,
  'sources.own_pages': 280,
  'ai.citation_share_by_domain_type': 180,
  'ai.fanout_top': 240,
  'sources.new_lost': 280,
  'sources.diversity': 240,
} as const;
/** One step of the spacing scale is 4 px: `h-45` is 180 px. */
const STEP = 4;

function blockHeight(container: HTMLElement): number {
  const block = container.querySelector('[data-slot="skeleton"]:not(.flex)');
  const match = /(?:^|\s)h-(\d+)(?:\s|$)/.exec(block?.className ?? '');
  if (match?.[1] === undefined) throw new Error('The skeleton has no block with an h-* class');
  return Number(match[1]) * STEP;
}

describe('the skeletons of the sources family', () => {
  it('lists the frame height of each card of the family', () => {
    expect(SOURCE_SKELETON_HEIGHTS).toEqual(FRAME_HEIGHTS);
  });

  it.each(Object.entries(FRAME_HEIGHTS))(
    'the skeleton of %s has a body of %i px, the height of its frame',
    (key, height) => {
      const Skeleton = SOURCE_SKELETONS[key];
      if (Skeleton === undefined) throw new Error(`No skeleton for ${key}`);
      const { container } = renderWithProviders(<Skeleton />);
      expect(blockHeight(container)).toBe(height);
    },
  );

  it('is hidden from assistive technology', () => {
    const Skeleton = SOURCE_SKELETONS['sources.top_domains'];
    if (Skeleton === undefined) throw new Error('No skeleton');
    const { container } = renderWithProviders(<Skeleton />);
    for (const piece of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(piece).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
