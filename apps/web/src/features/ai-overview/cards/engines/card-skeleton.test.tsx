import { describe, expect, it } from 'vitest';

import { skeletonOf } from './card-skeleton';
import { ChartFrame, type ChartHeight } from '@/components/app/chart/chart-frame';
import { renderWithProviders } from '@/test/render';

const HEIGHTS: readonly ChartHeight[] = [140, 180, 240, 280];
/** One step of the spacing scale is 4 px: `h-45` is 180 px. */
const STEP = 4;

/** The height in px that the skeleton block gets from its `h-*` class. */
function blockHeight(container: HTMLElement): number {
  // The text lines of the skeleton are flex rows; the block is the one that is not
  const block = container.querySelector('[data-slot="skeleton"]:not(.flex)');
  const match = /(?:^|\s)h-(\d+)(?:\s|$)/.exec(block?.className ?? '');
  if (match?.[1] === undefined) throw new Error('The skeleton has no block with an h-* class');
  return Number(match[1]) * STEP;
}

describe('skeletonOf', () => {
  it.each(HEIGHTS)('the skeleton block has the height class of the frame it stands for, at %i px', (height) => {
    const Skeleton = skeletonOf(height);
    const stand = renderWithProviders(<Skeleton />);
    const standIn = blockHeight(stand.container);
    stand.unmount();

    const frame = renderWithProviders(
      <ChartFrame
        title="Title"
        variant="panel"
        kind="html"
        body={null}
        table={null}
        height={height}
        summary="Summary"
        status="loading"
      />,
    );
    const frameBlock = frame.container.querySelector<HTMLElement>('section > div[style]');
    expect(frameBlock?.style.height).toBe(`${String(height)}px`);
    expect(standIn).toBe(height);
  });

  it('is hidden from assistive technology, as the registry skeletons are', () => {
    const Skeleton = skeletonOf(180);
    const { container } = renderWithProviders(<Skeleton />);
    for (const piece of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(piece).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
