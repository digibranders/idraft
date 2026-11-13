import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ACTIVITY_SKELETONS, SKELETON_HEIGHTS } from './skeletons';
import { CARD_TYPES } from '@/lib/layouts';

/** Section 1 of the WP-37 plan: the frame height of each card of the family, in px. */
const EXPECTED: Record<string, number> = {
  'activity.collection_status': 180,
  'ops.engines': 180,
  'ops.ai_spend': 140,
};

const BODY_CLASS: Record<number, string> = { 140: 'h-35', 180: 'h-45' };

/** The panel one skeleton renders, by catalog key. */
const panelOf = (key: string): HTMLElement => {
  const Skeleton = ACTIVITY_SKELETONS[key];
  if (Skeleton === undefined) throw new Error(`No skeleton for ${key}`);
  const { container } = render(<Skeleton />);
  const panel = container.firstElementChild;
  if (!(panel instanceof HTMLElement)) throw new Error('The skeleton renders nothing');
  return panel;
};

describe('the skeletons of the activity family', () => {
  it('has one skeleton for each card built so far, under an active catalog key of the screen', () => {
    expect(Object.keys(ACTIVITY_SKELETONS).sort()).toEqual(Object.keys(EXPECTED).sort());
    const active = new Set(
      CARD_TYPES.filter((type) => type.status === 'active' && type.screens.includes('ai_overview')).map(
        (type) => type.key,
      ),
    );
    for (const key of Object.keys(ACTIVITY_SKELETONS)) expect(active.has(key)).toBe(true);
  });

  it.each(Object.entries(EXPECTED))('%s has the height of its frame, %s px', (key, height) => {
    expect(SKELETON_HEIGHTS[key]).toBe(height);
    const panel = panelOf(key);
    expect(panel).toHaveAttribute('data-height', String(height));
    expect(panel.innerHTML).toContain(BODY_CLASS[height] ?? 'missing');
  });

  it('draws the panel of the pending card, hidden from assistive technology', () => {
    const panel = panelOf('ops.engines');
    expect(panel.className).toContain('border-border');
    const parts = panel.querySelectorAll('[data-slot="skeleton"]');
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).toHaveAttribute('aria-hidden', 'true');
  });
});
