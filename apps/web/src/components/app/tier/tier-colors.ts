import { tierPosition, type TierCodeLike } from '@/lib/internal-links/tiers';

/**
 * Whole class names per tier position, so Tailwind compiles them (26 section 10: a class is never built from a
 * variable). Index 0 is T1; Untiered has its own entry.
 */
const FILLS = [
  'bg-tier-1',
  'bg-tier-2',
  'bg-tier-3',
  'bg-tier-4',
  'bg-tier-5',
  'bg-tier-6',
  'bg-tier-7',
  'bg-tier-8',
] as const;
const EDGES = [
  'border-l-tier-1',
  'border-l-tier-2',
  'border-l-tier-3',
  'border-l-tier-4',
  'border-l-tier-5',
  'border-l-tier-6',
  'border-l-tier-7',
  'border-l-tier-8',
] as const;

/** The fill of a tier's square or bar segment. */
export const tierFill = (tier: TierCodeLike | null): string =>
  tier === null ? 'bg-tier-none' : (FILLS[tierPosition(tier) - 1] ?? 'bg-tier-none');

/** The 4 px left edge of a link card. */
export const tierEdge = (tier: TierCodeLike | null): string =>
  tier === null ? 'border-l-tier-none' : (EDGES[tierPosition(tier) - 1] ?? 'border-l-tier-none');
