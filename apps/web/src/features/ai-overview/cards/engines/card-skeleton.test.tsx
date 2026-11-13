import { describe, expect, it } from 'vitest';

import { skeletonOf } from './card-skeleton';
import { ENGINE_CARDS } from './index';
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

  // The height each change card gives its frame, so the page does not jump when the card replaces its skeleton
  it.each([
    ['ai.prompt_movers', 240],
    ['ai.period_comparison', 180],
    ['ai.change_waterfall', 240],
  ] as const)('the registered skeleton of %s is %i px, as its frame is', (key, height) => {
    const Skeleton = ENGINE_CARDS[key]?.skeleton;
    if (Skeleton === undefined) throw new Error(`${key} has no registered skeleton`);
    const { container } = renderWithProviders(<Skeleton />);
    expect(blockHeight(container)).toBe(height);
  });

  // A card is taller than its chart: legends, tables and footnotes follow it, and the stand-in says so
  it('draws a block under the first for each extra height, in order', () => {
    const Skeleton = skeletonOf(140, ['chart-180', 'row']);
    const { container } = renderWithProviders(<Skeleton />);
    const blocks = [...container.querySelectorAll<HTMLElement>('[data-slot="skeleton"]:not(.flex)')];
    expect(blocks.map((block) => /(?:^|\s)h-(\w+)(?:\s|$)/.exec(block.className)?.[1])).toEqual(['35', '45', 'row']);
  });

  it('is taller for the cards whose body is followed by more than a footnote', () => {
    const Rate = ENGINE_CARDS['ai.rate_trend_by_engine']?.skeleton;
    const Summary = ENGINE_CARDS['ai.change_summary']?.skeleton;
    if (Rate === undefined || Summary === undefined) throw new Error('A card has no registered skeleton');
    const rate = renderWithProviders(<Rate />);
    const rateBlocks = rate.container.querySelectorAll('[data-slot="skeleton"]:not(.flex)').length;
    rate.unmount();
    const summary = renderWithProviders(<Summary />);
    expect(rateBlocks).toBeGreaterThan(1);
    expect(summary.container.querySelectorAll('[data-slot="skeleton"]:not(.flex)').length).toBeGreaterThan(1);
  });

  it('is hidden from assistive technology, as the registry skeletons are', () => {
    const Skeleton = skeletonOf(180);
    const { container } = renderWithProviders(<Skeleton />);
    for (const piece of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(piece).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
