import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { COMPETITOR_SKELETONS, SKELETON_HEIGHTS } from './skeletons';
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

  it('draws the panel of the pending card: a border, a title line and a body, hidden from assistive technology', () => {
    const panel = panelOf('ai.share_of_voice');
    expect(panel.className).toContain('border-border');
    const parts = panel.querySelectorAll('[data-slot="skeleton"]');
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the tall body class of 280 px and of 240 px', () => {
    expect(panelOf('ai.share_of_voice').innerHTML).toContain('h-70');
    expect(panelOf('ai.sov_rank').innerHTML).toContain('h-60');
  });
});
