import type { EngineCode, ProjectEngine } from '@/lib/api/types';

/**
 * Which of the project's engines show the queries they issue. Pure: the engines say it (`engine.exposes_fanout`),
 * never a list of engine names here. An engine that is off is in neither list.
 */

/** The enabled engines that show their queries, in the project's order: the only ones a read may name. */
export const exposingEngines = (engines: readonly ProjectEngine[]): ProjectEngine[] =>
  engines.filter((entry) => entry.is_enabled && entry.engine.exposes_fanout);

/** The enabled engines that do not show their queries: not exposed, never zero. */
export const withoutFanout = (engines: readonly ProjectEngine[]): ProjectEngine[] =>
  engines.filter((entry) => entry.is_enabled && !entry.engine.exposes_fanout);

/**
 * The enabled engines that are chosen, split by whether they show their queries. An empty choice means every
 * enabled engine, as an empty engine filter does; a chosen engine that is off or not the project's is left out.
 */
export function engineSplit(
  engines: readonly ProjectEngine[],
  chosen: readonly EngineCode[],
): { exposing: ProjectEngine[]; without: ProjectEngine[] } {
  const asked = chosen.length === 0 ? engines : engines.filter((entry) => chosen.includes(entry.engine.engine_code));
  return { exposing: exposingEngines(asked), without: withoutFanout(asked) };
}
