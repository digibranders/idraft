import type { EngineCode } from '@/lib/api/types';
import type { SeriesRole } from '@/lib/charts/category-chart';
import { ENGINES } from '@/lib/layouts/catalog';

/*
 * What every card of the engines family says about an engine: its colour role, its chart token, its label and its
 * place. A feature may not import another feature, so `engineRole` is a copy of the one in
 * `features/prompts/history-model.ts`.
 * shortcut: a copy, kept in step by the parity test in engine-role.test.ts, until the role moves to `lib/charts`.
 */

/** The fixed order of the engines in a chart: the engine's colour never depends on its place in the data. */
const ENGINE_ORDER = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

/** The role (colour) of an engine's series: by the engine's place in the fixed order, never by its place in the data. */
export function engineRole(engineCode: string): SeriesRole {
  const place = ENGINE_ORDER.findIndex((code) => code === engineCode);
  if (place === 0) return { kind: 'brand' };
  return place === 1 || place === 2 ? { kind: 'palette', index: place === 1 ? 2 : 3 } : { kind: 'other' };
}

/** The chart token of an engine: ChatGPT `chart-1`, Gemini `chart-2`, AI Mode `chart-3`, any other `chart-other`. */
export type EngineChartColor = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-other';

const CHART_COLORS: ReadonlyMap<string, EngineChartColor> = new Map<string, EngineChartColor>([
  ['chatgpt_web', 'chart-1'],
  ['gemini_web', 'chart-2'],
  ['google_ai_mode', 'chart-3'],
]);

export const engineChartColor = (engineCode: string): EngineChartColor => CHART_COLORS.get(engineCode) ?? 'chart-other';

/** The label the catalog gives an engine ("AI Mode"); `null` for an engine it does not list, never its code. */
export const engineLabel = (engineCode: string): string | null =>
  ENGINES.find((engine) => engine.code === engineCode)?.label ?? null;

/** The engines named, once each, in the order of the catalog whatever the order they came in. */
export const inCatalogOrder = (codes: readonly EngineCode[]): EngineCode[] =>
  ENGINES.map((engine) => engine.code).filter((code) => codes.includes(code));
