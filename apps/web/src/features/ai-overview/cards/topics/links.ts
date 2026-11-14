import type { Route } from 'next';

import { drillHref, type DrillMetric } from '../../drilldown/drill-links';
import type { OverviewScope } from '../../scope/scope-model';
import type { TopicMetric } from './model-types';
import { withQuery } from '@/lib/routes/paths';

/**
 * Where a number of a topics card leads. `drillHref` (WP-33) carries the scope and knows the keys of the Prompts
 * page; this adds the two things only these cards need: the drawer's Prompts tab filtered to one engine (`itab` and
 * `eng`) and the view and sort of the Topics tab. A link is `null` where the page cannot show the scope, and the
 * number is then plain text. `links.test.ts` feeds every link to the Prompts page's own parsers.
 */

export interface LinkContext {
  workspaceSlug: string;
  projectSlug: string;
  scope: OverviewScope;
}

const projectOf = (ctx: LinkContext): { workspace: string; project: string } => ({
  workspace: ctx.workspaceSlug,
  project: ctx.projectSlug,
});

/** The metric as the Prompts page names it (`sov`). */
const METRIC_PARAM: Readonly<Record<TopicMetric, DrillMetric>> = {
  mention: 'mention',
  citation: 'citation',
  share_of_voice: 'sov',
};

/** The key of the topic drawer's tab and of the engine its Prompts tab is filtered to (`topics-by-engine/drill.ts`). */
const DRAWER_TAB_KEY = 'itab';
const DRAWER_PROMPTS_TAB = 'prompts';
const DRAWER_ENGINE_KEY = 'eng';

/** `href` with `params` set in its query; a parameter that is `undefined` is left out. */
function withParams(href: Route | null, params: Readonly<Record<string, string | undefined>>): Route | null {
  if (href === null) return null;
  const [path = '', query = ''] = href.split('?');
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) next.set(key, value);
  return withQuery(path as Route, next.toString());
}

/** The drawer of a topic over the Prompts page, on its Overview tab; `topicKey` is a term id or `__none`. */
export const topicDrawerHref = (ctx: LinkContext, topicKey: string): Route | null =>
  drillHref('topicDrawer', ctx.scope, { term: topicKey }, projectOf(ctx));

/** The drawer of a topic on its Prompts tab, filtered to one engine, and the page showing that engine. */
export const topicEngineHref = (ctx: LinkContext, topicKey: string, engineCode: string): Route | null =>
  withParams(drillHref('topicDrawer', ctx.scope, { term: topicKey, engine: engineCode }, projectOf(ctx)), {
    [DRAWER_TAB_KEY]: DRAWER_PROMPTS_TAB,
    [DRAWER_ENGINE_KEY]: engineCode,
  });

/** The inspector of one prompt over the Prompts page. */
export const promptHref = (ctx: LinkContext, promptId: string): Route | null =>
  drillHref('prompt', ctx.scope, { promptId }, projectOf(ctx));

/** The Prompts tab: with `engine`, only that engine, sorted by its rate; with `topic`, only that topic and below. */
export const promptsTabHref = (
  ctx: LinkContext,
  extra: { engine?: string; topic?: string; metric?: TopicMetric } = {},
): Route | null =>
  drillHref(
    'prompts',
    ctx.scope,
    {
      engine: extra.engine,
      term: extra.topic,
      metric: extra.metric === undefined ? undefined : METRIC_PARAM[extra.metric],
    },
    projectOf(ctx),
  );

/** The Topics tab in one of its views, on one metric, optionally sorted (`sort` as the view reads it). */
export const topicsTabHref = (
  ctx: LinkContext,
  extra: { view: 'heatmap' | 'engines'; metric: TopicMetric; sort?: string },
): Route | null =>
  withParams(drillHref('topic', ctx.scope, {}, projectOf(ctx)), {
    view: extra.view,
    metric: extra.metric === 'mention' ? undefined : METRIC_PARAM[extra.metric],
    sort: extra.sort,
  });
