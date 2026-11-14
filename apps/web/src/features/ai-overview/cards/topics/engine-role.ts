import type { SeriesRole } from '@/lib/charts/category-chart';

// shortcut: copy of engineRole in features/prompts/history-model.ts (a feature may not import another one),
// move to lib/charts/engine-role.ts with lease L-A; parity.test.ts imports the original so a drift fails

/** The fixed order of the engines in a chart (14-badges-status.md section 4): ChatGPT `chart-1`, Gemini `chart-2`, AI Mode `chart-3`. */
const ENGINE_ORDER = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

/** The role (colour) of an engine's series: by the engine's place in the fixed order, never by its place in the data. */
export function engineRole(engineCode: string): SeriesRole {
  const place = ENGINE_ORDER.findIndex((code) => code === engineCode);
  if (place === 0) return { kind: 'brand' };
  return place === 1 || place === 2 ? { kind: 'palette', index: place === 1 ? 2 : 3 } : { kind: 'other' };
}
