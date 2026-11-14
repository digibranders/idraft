import type { ProjectEngine } from '@/lib/api/types';
import { money } from '@/lib/format/money';

/**
 * What the engines card lists: one row per project engine, as the API lists them. Engines are rows and never
 * added up, so this holds no total.
 *
 * The cost is the API's estimate of a month of the engine's active prompts. It is `estimate` for an engine that is
 * on, `if_on` for one that is off (what it would cost), and `unknown` where the price book has no price: unknown is
 * never a cost of zero.
 */
export type EngineCost = { kind: 'estimate'; usd: number } | { kind: 'if_on'; usd: number } | { kind: 'unknown' };

export interface EngineRow {
  code: string;
  label: string;
  isOn: boolean;
  cost: EngineCost;
}

function costOf(engine: ProjectEngine): EngineCost {
  const usd = engine.estimated_monthly_cost_usd === null ? null : money(engine.estimated_monthly_cost_usd);
  if (usd === null) return { kind: 'unknown' };
  return { kind: engine.is_enabled ? 'estimate' : 'if_on', usd };
}

export function engineRows(engines: readonly ProjectEngine[]): EngineRow[] {
  return engines.map((engine) => ({
    code: engine.engine.engine_code,
    label: engine.engine.label,
    isOn: engine.is_enabled,
    cost: costOf(engine),
  }));
}
