import { inCatalogOrder } from '../../engines/engine-role';
import type { DomainRole, EngineCode, SourcesMeta } from '@/lib/citations/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * The citation units of each source role on each engine, as figures (WP-37 plan T2, CH-16 and WB-OV-07). Pure. Every
 * engine is its own total: engines are never added together, and an engine with no citation unit has no share (none),
 * which is not a share of 0.
 */

/** The roles in their fixed order: a segment keeps its place whatever the data. */
export const ROLES = ['own', 'competitor', 'third_party'] as const satisfies readonly DomainRole[];

export interface RoleShare {
  role: DomainRole;
  units: number;
  /** Units over the engine's total, 0 to 1; a real 0 when the role has no unit on an engine that has some. */
  share: number;
}

/**
 * - `ok`: the three shares of one engine, which add up to 1 over its `total` citation units.
 * - `thin`: so few answers cite on this engine that a share would claim too much; `answers` is how many at most, and
 *   `total` its citation units, which are known.
 * - `none`: no citation unit on this engine: no bar, and not 0%.
 * - `unavailable`: the read did not carry the split by engine, so nothing is known of this engine: not none, not 0%.
 */
export type EngineRoleMix =
  | { engineCode: EngineCode; state: 'ok'; total: number; shares: RoleShare[] }
  | { engineCode: EngineCode; state: 'thin'; answers: number; total: number }
  | { engineCode: EngineCode; state: 'none' }
  | { engineCode: EngineCode; state: 'unavailable' };

/** The split of each engine the read asked, in the order of the catalog. */
export function roleMix(meta: Pick<SourcesMeta, 'engine_codes' | 'by_role_by_engine'>): EngineRoleMix[] {
  const blocks = meta.by_role_by_engine;
  return inCatalogOrder(meta.engine_codes).map((engineCode): EngineRoleMix => {
    if (blocks === undefined || blocks === null) return { engineCode, state: 'unavailable' };
    const block = blocks.find((entry) => entry.engine_code === engineCode);
    if (block === undefined) return { engineCode, state: 'none' };
    const units = (role: DomainRole): number => block[role].citation_units;
    const total = ROLES.reduce((sum, role) => sum + units(role), 0);
    if (total === 0) return { engineCode, state: 'none' };
    // shortcut: one answer can cite several roles, so this sum is an upper bound of the citing answers; a thin flag
    // from it is never a false alarm, and the exact count per engine arrives with the API (no field for it yet)
    const answers = ROLES.reduce((sum, role) => sum + block[role].answers_citing, 0);
    if (answers < MIN_OBSERVATIONS) return { engineCode, state: 'thin', answers, total };
    return {
      engineCode,
      state: 'ok',
      total,
      shares: ROLES.map((role) => ({ role, units: units(role), share: units(role) / total })),
    };
  });
}
