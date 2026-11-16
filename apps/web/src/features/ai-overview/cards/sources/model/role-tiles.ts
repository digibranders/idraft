import type { DomainRole, SourcesMeta } from '@/lib/citations/types';

/** The roles in their fixed order: a tile keeps its colour whatever the data. */
export const ROLE_ORDER = ['own', 'competitor', 'third_party'] as const satisfies readonly DomainRole[];

export interface RoleTile {
  role: DomainRole;
  units: number;
  /** Units over the units of all three roles, 0 to 1: the areas of the treemap add up to the whole. */
  share: number;
}

export interface RoleTiles {
  /** The citation units of the three roles added up: the denominator of every share. */
  total: number;
  /** The roles in order, each with its units; a role with no unit is in the list with 0 and has no area. */
  tiles: RoleTile[];
}

/**
 * The citation units of the scope by the role of the domain that was cited (OV-CIT-03 and OV-CIT-04, until the API
 * classifies domain types, WP-60). The areas partition the units, so the shares share one denominator, their own sum.
 * A scope with no unit has no tiles.
 */
export function roleTiles(meta: Pick<SourcesMeta, 'by_role'>): RoleTiles {
  const unitsOf = (role: DomainRole): number =>
    meta.by_role.find((entry) => entry.domain_role === role)?.citation_units ?? 0;
  const total = ROLE_ORDER.reduce((sum, role) => sum + unitsOf(role), 0);
  if (total === 0) return { total, tiles: [] };
  return {
    total,
    tiles: ROLE_ORDER.map((role) => ({ role, units: unitsOf(role), share: unitsOf(role) / total })),
  };
}
