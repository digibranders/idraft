/**
 * Page tiers as the screens read them (spec 5.1): the code (T1 to T8) comes from the position, and a `null`
 * tier is Untiered. Structural types, so the helpers work on the API's `TierRef` and `PageTier` alike.
 */

/** A workspace has at most this many tiers. */
export const MAX_TIERS = 8;
/** Untiered sorts after every tier. */
export const UNTIERED_POSITION = 99;

export interface TierCodeLike {
  code: string;
}

export interface TierNameLike extends TierCodeLike {
  name: string;
}

const CODE = /^T([1-8])$/;

/** 1 for T1; `UNTIERED_POSITION` for Untiered. Throws on a code the API never sends. */
export function tierPosition(tier: TierCodeLike | null): number {
  if (tier === null) return UNTIERED_POSITION;
  const match = CODE.exec(tier.code);
  if (match === null) throw new Error(`Not a tier code: ${tier.code}`);
  return Number(match[1]);
}

/** "T1 Money pages", or the word for Untiered. */
export const tierLabel = (tier: TierNameLike | null, untiered: string): string =>
  tier === null ? untiered : `${tier.code} ${tier.name}`;
