/**
 * Search share of voice is not built (follow-up F-26: `seo` is declared and absent in c5), so the family carries no
 * number for it, not a placeholder and not a zero (decision D-2). Only a card that shows a Search column renders
 * this, as "Not available" with the reason in a tooltip.
 */
export interface SeoShareNotAvailable {
  readonly available: false;
  readonly reason: 'not_built';
}

export const SEO_SHARE: SeoShareNotAvailable = { available: false, reason: 'not_built' };
