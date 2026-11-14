import type { DomainFigures } from './domain-rows';
import type { UnitShare } from '@/lib/citations/share-model';
import type { DomainRole, SourcesMeta } from '@/lib/citations/types';

/**
 * The listed domains grouped by role, for the "By role" view of the top cited domains card (WP-37 plan T5, CH-34).
 * Pure: numbers in, numbers out, no text. The units of a role come from `meta.by_role`, which no row limit narrows,
 * so the listed units plus what each role has left over add up to every citation unit in scope.
 */

/** The order the sections are drawn in. */
export const ROLE_ORDER = ['own', 'competitor', 'third_party'] as const satisfies readonly DomainRole[];

export interface RoleGroup {
  role: DomainRole;
  /** Citation units of the role in scope; the listed units when the read does not tell (`atLeast`). */
  units: number;
  /** The role total is not known: `units` is the least it can be, and a share over it the least it can be. */
  atLeast: boolean;
  /** `units` over every unit in scope; `null` when no unit is in scope. */
  share: UnitShare;
  /** The listed domains of the role, in the order the route gave them. A domain of two roles is in both groups. */
  rows: readonly DomainFigures[];
  listedUnits: number;
  /** Units of the role in domains that are not listed (past the row limit or under the minimum). */
  remainderUnits: number;
}

export interface RoleGroups {
  groups: readonly RoleGroup[];
}

/**
 * The three role groups of a read. A role the read has no total for, or whose total is under what its own listed
 * rows hold, is `atLeast` and shows the listed units: a total is never invented, and the remainder never goes negative.
 */
export function roleGroups(
  figures: readonly DomainFigures[],
  meta: Pick<SourcesMeta, 'by_role' | 'citation_units'>,
): RoleGroups {
  const total = meta.citation_units;
  const groups = ROLE_ORDER.map((role): RoleGroup => {
    const rows = figures.filter((figure) => figure.role === role);
    const listedUnits = rows.reduce((sum, row) => sum + row.units, 0);
    const told = meta.by_role.find((entry) => entry.domain_role === role)?.citation_units;
    const atLeast = told === undefined || told < listedUnits;
    const units = atLeast ? listedUnits : told;
    return {
      role,
      units,
      atLeast,
      share: { value: total === 0 ? null : units / total, units, total },
      rows,
      listedUnits,
      remainderUnits: units - listedUnits,
    };
  });
  return { groups };
}
