import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { COMPETITOR_SKELETONS, loadingBodyHeight, SKELETON_HEIGHTS, SKELETON_TOTALS } from './skeletons';
import { CARD_TYPES } from '@/lib/layouts';

/** D-13 of the plan: the height of the body of each card of the family. */
const EXPECTED: Record<string, number> = {
  'ai.share_of_voice': 280,
  'ai.lost_to_competitor': 240,
  'ai.opportunities': 240,
  'ai.competitor_trend': 240,
  'ai.sov_over_time': 280,
  'ai.sov_rank': 240,
  'ai.co_mentions': 280,
  'ai.competitor_table': 280,
};

/** The panel one skeleton renders, by catalog key. */
const panelOf = (key: string): HTMLElement => {
  const Skeleton = COMPETITOR_SKELETONS[key];
  if (Skeleton === undefined) throw new Error(`No skeleton for ${key}`);
  const { container } = render(<Skeleton />);
  const panel = container.firstElementChild;
  if (!(panel instanceof HTMLElement)) throw new Error('The skeleton renders nothing');
  return panel;
};

describe('the skeletons of the competitors family', () => {
  it('has one skeleton for each card of the family, under its catalog key', () => {
    expect(Object.keys(COMPETITOR_SKELETONS).sort()).toEqual(Object.keys(EXPECTED).sort());
    const active = new Set(
      CARD_TYPES.filter((type) => type.status === 'active' && type.screens.includes('ai_overview')).map(
        (type) => type.key,
      ),
    );
    for (const key of Object.keys(COMPETITOR_SKELETONS)) expect(active.has(key)).toBe(true);
  });

  it.each(Object.entries(EXPECTED))('%s exposes the height of its frame, %s px', (key, height) => {
    expect(SKELETON_HEIGHTS[key]).toBe(height);
    expect(panelOf(key)).toHaveAttribute('data-height', String(height));
  });

  /** The whole panel of the card once loaded, at the default options (the breakdown is in `skeletons.tsx`). */
  const TOTALS: Record<string, number> = {
    'ai.share_of_voice': 514,
    'ai.lost_to_competitor': 382,
    'ai.opportunities': 542,
    'ai.competitor_trend': 422,
    'ai.sov_over_time': 462,
    'ai.sov_rank': 542,
    'ai.co_mentions': 966,
    'ai.competitor_table': 685,
  };

  it.each(Object.entries(TOTALS))('%s is as tall as the loaded card, %s px', (key, total) => {
    expect(SKELETON_TOTALS[key]).toBe(total);
    expect(panelOf(key)).toHaveStyle({ height: `${total}px` });
  });

  /**
   * The body a card's own loading frame reserves, by catalog key. While its read loads a card draws the border and
   * padding (34 px), a title line (24 px) and the gap below it (12 px) around it, plus the footnote lines it already
   * has without data: the opportunities scope notes (2 lines), the table's one note, and the co-mentions footnote
   * element with no lines yet (still one 12 px gap).
   */
  const LOADING_BODIES: Record<string, number> = {
    'ai.share_of_voice': 444,
    'ai.lost_to_competitor': 312,
    'ai.opportunities': 420,
    'ai.competitor_trend': 352,
    'ai.sov_over_time': 392,
    'ai.sov_rank': 472,
    'ai.co_mentions': 884,
    'ai.competitor_table': 583,
  };

  it.each(Object.entries(LOADING_BODIES))('%s reserves %s px of body while its read loads', (key, body) => {
    expect(loadingBodyHeight(key)).toBe(body);
  });

  it('never reserves less than the body of its frame, and throws for a key that is not in the family', () => {
    for (const [key, body] of Object.entries(SKELETON_HEIGHTS)) {
      expect(loadingBodyHeight(key)).toBeGreaterThanOrEqual(body);
    }
    expect(() => loadingBodyHeight('ai.unknown')).toThrow('ai.unknown');
  });

  it('is never shorter than the body its frame reserves plus the chrome of a panel', () => {
    for (const [key, body] of Object.entries(SKELETON_HEIGHTS)) {
      // Border and padding (34 px) and the title line (20 px) at the least
      expect(SKELETON_TOTALS[key]).toBeGreaterThanOrEqual(body + 54);
    }
  });

  it('draws the panel of the pending card: a border, a title line and a body, hidden from assistive technology', () => {
    const panel = panelOf('ai.share_of_voice');
    expect(panel.className).toContain('border-border');
    const parts = panel.querySelectorAll('[data-slot="skeleton"]');
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).toHaveAttribute('aria-hidden', 'true');
  });

  it('lets the body take what is left of the panel after the title line', () => {
    const body = panelOf('ai.sov_rank').lastElementChild;
    expect(body?.className).toContain('flex-1');
    expect(body?.querySelector('[data-slot="skeleton"]')?.className).toContain('h-full');
  });
});
