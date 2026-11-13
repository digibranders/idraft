import type { Route } from 'next';

import { writeRangeParams } from '@/components/app/date-range/range-model';
import { cmpParam } from '@/lib/compare/compare-model';
import { formatInspectTarget } from '@/lib/inspector/placement';
import { NAVIGATION, type NavKey } from '@/lib/navigation/registry';
import { projectPath, withQuery } from '@/lib/routes/paths';
import { formatSort } from '@/lib/tables/table-state';

import type { Branded, OverviewScope } from '../scope/scope-model';

/**
 * Where a number of the Overview leads (WP-33 plan T10, finding F6): the one place that knows both the
 * Overview's URL keys and those of the pages it opens, so a rename on either side is a change to this file.
 *
 * A feature may not import another feature, so the keys of the Prompts page (`tab`, `engine`, `country`, `topic`,
 * `branded`, `sort`, `metric`, `inspect`, and the sort id `<engine_code>_rate`) are written out here. The source
 * of truth is `features/prompts/prompt-model.ts` and `prompts-screen.tsx`; `drill-links.test.ts` feeds every link
 * to that page's own parsers, so a rename there fails the test and not the person who follows a link.
 *
 * A link is `null` (the number is plain text) rather than a link that would show other numbers than the ones
 * clicked: the page is not live, or the scope has a country or a branded choice the page cannot express.
 */

export type DrillKind =
  /** The Prompts tab of Topics & Prompts. */
  | 'prompts'
  /** The Topics tab (the page's default tab, so no `tab` is written). */
  | 'topic'
  /** The topic drawer over the Prompts page: `inspect=topic:<term>`. */
  | 'topicDrawer'
  | 'citations'
  | 'competitors'
  | 'sources'
  | 'runs';

/** The rate a number shows, which the Prompts page's engine columns take as `metric`. */
export type DrillMetric = 'mention' | 'citation' | 'sov';

export interface DrillExtra {
  /** One engine code, in place of the engines of the scope (an engine's own number). */
  engine?: string | undefined;
  /** Metric of the rate; mention is the page's default and is not written. */
  metric?: DrillMetric | undefined;
  /** The topic term to open (`topicDrawer`) or to filter to (`topic`), in place of the topic of the scope. */
  term?: string | undefined;
  outcome?: string | undefined;
  opportunity?: string | undefined;
}

export interface DrillProject {
  workspace: string;
  project: string;
}

export type DrillSupport = Readonly<Record<DrillKind, { outcome: boolean; opportunity: boolean }>>;

/**
 * Which of the extra parameters a destination reads. The Prompts page has no outcome or opportunity filter
 * until WP-17 adds them, so nothing is written: the cards render the number as plain text meanwhile.
 */
export const DRILL_SUPPORT: DrillSupport = {
  prompts: { outcome: false, opportunity: false },
  topic: { outcome: false, opportunity: false },
  topicDrawer: { outcome: false, opportunity: false },
  citations: { outcome: false, opportunity: false },
  competitors: { outcome: false, opportunity: false },
  sources: { outcome: false, opportunity: false },
  runs: { outcome: false, opportunity: false },
};

interface Destination {
  /** The entry of the navigation registry: it gives the path and whether the page exists. */
  nav: NavKey;
  /** False for a page the scope does not apply to: its link is the path alone. */
  scoped: boolean;
  /** Whether the page reads `country`. */
  country: boolean;
  /** The value of `branded` for each choice; a choice missing here cannot be expressed on the page. */
  branded: Partial<Record<Branded, string | null>>;
}

/** The Prompts and Citations pages have one Branded choice, `include`; excluded is the default and is not written. */
const BRANDED_INCLUDE: Destination['branded'] = { excluded: null, included: 'include' };

// competitors and sources are not built: their keys are to be checked against the pages when they are
const DESTINATIONS: Readonly<Record<DrillKind, Destination>> = {
  prompts: { nav: 'prompts', scoped: true, country: true, branded: BRANDED_INCLUDE },
  topic: { nav: 'prompts', scoped: true, country: true, branded: BRANDED_INCLUDE },
  topicDrawer: { nav: 'prompts', scoped: true, country: true, branded: BRANDED_INCLUDE },
  citations: { nav: 'citations', scoped: true, country: false, branded: BRANDED_INCLUDE },
  competitors: { nav: 'competitors', scoped: true, country: true, branded: BRANDED_INCLUDE },
  sources: { nav: 'sources', scoped: true, country: true, branded: BRANDED_INCLUDE },
  // Runs reads a month, not a window: the scope means nothing there
  runs: { nav: 'runs', scoped: false, country: false, branded: BRANDED_INCLUDE },
};

/** The sort id of an engine's rate column on the Prompts tab (`engineSortId` of the Prompts page). */
const engineRateSort = (engineCode: string): string => `${engineCode}_rate`;

/**
 * The link for `kind` with the scope of the Overview carried, or `null` where there is no page to go to or the
 * page cannot show this scope. Nothing here throws: a window or a term that does not read is written as it is
 * and the page falls back to its own default.
 *
 * `support` is `DRILL_SUPPORT`; it is a parameter so a test can turn a destination on.
 */
export function drillHref(
  kind: DrillKind,
  scope: OverviewScope,
  extra: DrillExtra,
  project: DrillProject,
  support: DrillSupport = DRILL_SUPPORT,
): Route | null {
  // A kind from outside the type system (a hand-built string) is no destination
  const destination = (DESTINATIONS as Partial<Record<DrillKind, Destination>>)[kind];
  if (destination === undefined) return null;
  const page = NAVIGATION.find((item) => item.key === destination.nav);
  if (page === undefined || page.status !== 'live') return null;
  const path = projectPath(project.workspace, project.project, page.path);
  if (!destination.scoped) return path;

  const branded = destination.branded[scope.branded];
  if (branded === undefined || (scope.country !== null && !destination.country)) return null;
  const drawer = kind === 'topicDrawer' ? (extra.term ?? scope.topic) : null;
  if (kind === 'topicDrawer' && drawer === null) return null;

  const query = new URLSearchParams();
  const put = (key: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== '') query.set(key, value);
  };
  const { win, from, to } = writeRangeParams(scope.rangeValue);
  put('win', win);
  put('from', from);
  put('to', to);
  put('cmp', cmpParam(scope.compare));
  put('country', scope.country);
  const engines = extra.engine === undefined ? scope.engines : [extra.engine];
  put('engine', engines === null ? null : engines.join(','));
  put('topic', kind === 'topicDrawer' ? scope.topic : (extra.term ?? scope.topic));
  put('branded', branded);
  if (kind === 'prompts') {
    put('tab', 'prompts');
    if (extra.engine !== undefined) put('sort', formatSort([{ id: engineRateSort(extra.engine), desc: true }]));
    if (extra.metric !== undefined && extra.metric !== 'mention') put('metric', extra.metric);
  }
  if (drawer !== null) put('inspect', formatInspectTarget({ type: 'topic', id: drawer }));
  if (support[kind].outcome) put('outcome', extra.outcome);
  if (support[kind].opportunity) put('opportunity', extra.opportunity);
  return withQuery(path, query.toString());
}
