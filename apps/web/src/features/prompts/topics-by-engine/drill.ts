import type { Route } from 'next';

import { formatInspectTarget } from '@/lib/inspector/placement';

/**
 * The address state of the Topics tab views and of the drill-down from a topic's engine cell (WB-TPE-07 and 12):
 * `?view=` picks the view, `?inspect=topic:<id>&itab=prompts&eng=<code>` opens a topic's prompts on one engine.
 */

/** The query key of the engine the topic drawer's Prompts tab is filtered to. */
export const ENGINE_PARAM = 'eng';

/** What the topic drawer tells `useInspector` belongs to its entry: the engine goes with the drawer, on every page. */
export const DRAWER_ENTRY_KEYS = [ENGINE_PARAM] as const;

export type TopicsView = 'list' | 'engines' | 'heatmap';

/** The view an address names: the List when it names none or one this build does not know. */
export const parseView = (value: string | null): TopicsView =>
  value === 'engines' || value === 'heatmap' ? value : 'list';

/** The engine an address names, only when it is one of `codes` (the engines shown); a hand-edited code names none. */
export const parseEngineParam = (value: string | null, codes: readonly string[]): string | null =>
  value !== null && codes.includes(value) ? value : null;

/**
 * The address that opens a topic's drawer on its Overview, from the current address: every other key stays, an
 * earlier `inspect`, `itab` and `eng` are replaced or dropped (a heat map row, WB-TPE-07).
 */
export function topicHref(pathname: string, search: string, topicKey: string): Route {
  const params = new URLSearchParams(search);
  params.set('inspect', formatInspectTarget({ type: 'topic', id: topicKey }));
  params.delete('itab');
  params.delete(ENGINE_PARAM);
  // The path is the page's own, so it is a route of the app; typed routes cannot know that of a built string
  return `${pathname}?${params.toString()}` as Route;
}

/**
 * The address that opens the Prompts tab of a topic filtered to one engine, from the current address: every other
 * key stays, an earlier `inspect`, `itab` and `eng` are replaced. `topicKey` is a topic id, or `__none`.
 */
export function drillHref(pathname: string, search: string, topicKey: string, engineCode: string): Route {
  const params = new URLSearchParams(search);
  params.set('inspect', formatInspectTarget({ type: 'topic', id: topicKey }));
  params.set('itab', 'prompts');
  params.set(ENGINE_PARAM, engineCode);
  // The path is the page's own, so it is a route of the app; typed routes cannot know that of a built string
  return `${pathname}?${params.toString()}` as Route;
}
