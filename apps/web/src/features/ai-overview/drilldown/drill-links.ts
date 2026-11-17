import type { Route } from 'next';

import { MAX_RANGE_DAYS, writeRangeParams } from '@/components/app/date-range/range-model';
import { CMP_YEAR, cmpParam } from '@/lib/compare/compare-model';
import { formatInspectTarget, type InspectorTarget } from '@/lib/inspector/placement';
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
 * clicked: the page is not live, or the scope has a country, a branded choice or a window the page cannot express.
 * The helper cannot know which engines are off in the project: the caller skips the link when the scope holds one.
 */

export type DrillKind =
  /** The Prompts tab of Topics & Prompts. */
  | 'prompts'
  /** The Topics tab (the page's default tab, so no `tab` is written). */
  | 'topic'
  /** The topic drawer over the Prompts page: `inspect=topic:<term>`. */
  | 'topicDrawer'
  /** The prompt inspector over the Prompts page: `inspect=prompt:<id>`, on whichever tab the page opens. */
  | 'prompt'
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
  /** The prompt to open (`prompt`, required). */
  promptId?: string | undefined;
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
  prompt: { outcome: false, opportunity: false },
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
  /**
   * How the page reads `cmp`. The Prompts page opens with no comparison and turns it on only for `cmp=previous`; the
   * other pages compare by default and turn it off with `cmp=off`. The link writes what makes the page open as the
   * Overview is: comparing, or not.
   */
  compare: 'previous-turns-on' | 'off-turns-off';
}

/** The Citations page and the others have one Branded choice, `include`; excluded is the default and is not written. */
const BRANDED_INCLUDE: Destination['branded'] = { excluded: null, included: 'include' };
/** The Prompts page has `Only` too (`branded=only`: the branded prompts alone). */
const BRANDED_PROMPTS: Destination['branded'] = { ...BRANDED_INCLUDE, only: 'only' };

/** The `cmp` that makes `page` open as the Overview is: the period before, last year, or no comparison. */
function cmpOf(page: Destination['compare'], scope: OverviewScope): string | null {
  if (page === 'off-turns-off') return cmpParam(scope.compare);
  if (!scope.compare) return null;
  return scope.compareKind === 'previous_year' ? CMP_YEAR : 'previous';
}

// competitors and sources are not built: their keys are to be checked against the pages when they are
const DESTINATIONS: Readonly<Record<DrillKind, Destination>> = {
  prompts: { nav: 'prompts', scoped: true, country: true, branded: BRANDED_PROMPTS, compare: 'previous-turns-on' },
  topic: { nav: 'prompts', scoped: true, country: true, branded: BRANDED_PROMPTS, compare: 'previous-turns-on' },
  topicDrawer: { nav: 'prompts', scoped: true, country: true, branded: BRANDED_PROMPTS, compare: 'previous-turns-on' },
  prompt: { nav: 'prompts', scoped: true, country: true, branded: BRANDED_PROMPTS, compare: 'previous-turns-on' },
  citations: { nav: 'citations', scoped: true, country: false, branded: BRANDED_INCLUDE, compare: 'off-turns-off' },
  competitors: { nav: 'competitors', scoped: true, country: true, branded: BRANDED_INCLUDE, compare: 'off-turns-off' },
  sources: { nav: 'sources', scoped: true, country: true, branded: BRANDED_INCLUDE, compare: 'off-turns-off' },
  // Runs reads a month, not a window: the scope means nothing there
  runs: { nav: 'runs', scoped: false, country: false, branded: BRANDED_INCLUDE, compare: 'off-turns-off' },
};

const termTarget = (id: string | null | undefined): InspectorTarget | null =>
  id === null || id === undefined ? null : { type: 'topic', id };
const promptTarget = (id: string | undefined): InspectorTarget | null =>
  id === undefined ? null : { type: 'prompt', id };

/** The sort id of an engine's rate column on the Prompts tab (`engineSortId` of the Prompts page). */
const engineRateSort = (engineCode: string): string => `${engineCode}_rate`;

/**
 * The columns the Prompts tab shows when a link sorts by a platform's rate. That column waits in the column chooser by
 * default, and the page applies a sort only to a column that is on screen, so the link names the columns it needs: the
 * ones the tab opens with (Group, Location while the top bar has no location, Mention rate and Citation rate) and the
 * platform's rate. The Prompt column is always there. Written out in `cols` as the page parses it (`parseColumns`).
 */
function promptColumnsFor(engineCode: string, country: string | null): string {
  return ['topic', ...(country === null ? ['country'] : []), 'mention', 'citation', engineRateSort(engineCode)].join(
    ',',
  );
}

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
  // The Overview takes 92 days; the pages read a range with the default limit and would open another window
  if (scope.range.days > MAX_RANGE_DAYS) return null;

  const branded = destination.branded[scope.branded];
  if (branded === undefined || (scope.country !== null && !destination.country)) return null;
  // A comparison with last year is one the Prompts page alone can express: the others would show the period before
  if (scope.compare && scope.compareKind === 'previous_year' && destination.compare === 'off-turns-off') return null;
  // The object a drawer opens: a topic term (the scope's topic when none is given) or a prompt
  const target: InspectorTarget | null =
    kind === 'topicDrawer'
      ? termTarget(extra.term ?? scope.topic)
      : kind === 'prompt'
        ? promptTarget(extra.promptId)
        : null;
  if ((kind === 'topicDrawer' || kind === 'prompt') && target === null) return null;

  const query = new URLSearchParams();
  const put = (key: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== '') query.set(key, value);
  };
  const { win, from, to } = writeRangeParams(scope.rangeValue);
  put('win', win);
  put('from', from);
  put('to', to);
  put('cmp', cmpOf(destination.compare, scope));
  put('country', scope.country);
  const engines = extra.engine === undefined ? scope.engines : [extra.engine];
  put('engine', engines === null ? null : engines.join(','));
  // A drawer's own term is not a filter: the scope's topic is
  put('topic', kind === 'topicDrawer' || kind === 'prompt' ? scope.topic : (extra.term ?? scope.topic));
  put('branded', branded);
  if (kind === 'prompts') {
    put('tab', 'prompts');
    if (extra.engine !== undefined) {
      put('sort', formatSort([{ id: engineRateSort(extra.engine), desc: true }]));
      put('cols', promptColumnsFor(extra.engine, scope.country));
    }
    if (extra.metric !== undefined && extra.metric !== 'mention') put('metric', extra.metric);
  }
  if (target !== null) put('inspect', formatInspectTarget(target));
  if (support[kind].outcome) put('outcome', extra.outcome);
  if (support[kind].opportunity) put('opportunity', extra.opportunity);
  return withQuery(path, query.toString());
}
