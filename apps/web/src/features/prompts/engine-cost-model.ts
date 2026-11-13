import type { ProjectEngine } from '@/lib/api/types';
import { money } from '@/lib/format/money';

export interface EngineCostChange {
  /** Dollars a month more (positive) or less (negative); `null` when the engine has no price on record. */
  delta: number | null;
  /** Dollars a month for the engines that are on after the change; `null` when one of them has no price. */
  enabledTotal: number | null;
  /** How many engines are on after the change. */
  enabledCount: number;
}

/** The monthly price of an engine as a number, or `null` for a missing or malformed one: unknown is never zero. */
const priceOf = (engine: ProjectEngine): number | null =>
  engine.estimated_monthly_cost_usd === null ? null : money(engine.estimated_monthly_cost_usd);

/**
 * What switching one engine does to the monthly estimate, read from the loaded list. The engine `code` is
 * taken as `turnedOn` says, whatever the list holds for it, so the list can be the one from before the save or
 * the one read after it; every other engine counts as the list has it.
 */
export function engineCostChange(engines: readonly ProjectEngine[], code: string, turnedOn: boolean): EngineCostChange {
  const switched = engines.find((engine) => engine.engine.engine_code === code);
  if (switched === undefined) return { delta: null, enabledTotal: null, enabledCount: 0 };
  const price = priceOf(switched);
  const on = engines.filter((engine) => (engine.engine.engine_code === code ? turnedOn : engine.is_enabled));
  const prices = on.map(priceOf);
  return {
    delta: price === null ? null : turnedOn ? price : -price,
    enabledTotal: prices.some((value) => value === null)
      ? null
      : prices.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    enabledCount: on.length,
  };
}
