'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { MIN_DOMAIN_UNITS, sourceFilters, sourcesAskable, type SourcesAskable } from './source-filters';
import { comparisonWindow } from '../../../data/overview-queries';
import { mapRead, useRead, type Gate, type Read } from '../../../data/read-state';
import type { ReadOptions } from '../../../data/use-overview-reads';
import { useOverview } from '../../../overview-context';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import {
  filterParams,
  flagParams,
  sourceChangesQuery,
  sourceDomainsQuery,
  sourcePagesQuery,
  type DomainInclude,
} from '@/lib/citations/source-queries';
import type {
  DomainRole,
  SourceChangePage,
  SourceDiversity,
  SourceDomainPage,
  SourcePagePage,
  SourcesMeta,
} from '@/lib/citations/types';

/**
 * The reads of the sources family (WP-37 plan section 3): the Overview hooks hold only the meta of a one-row read,
 * so the rows of the cards are read here, from the same factories the Citations page uses. Two cards with equal
 * options are one request (they share the query key). No component calls the API.
 */

const NO_ROLES: readonly DomainRole[] = [];
const NO_INCLUDE: readonly DomainInclude[] = [];

/**
 * How a read of this family stands: `idle` when it has nothing to ask, `paused` while the card is not live (customize
 * mode: it asks nothing, keeps the data it has for the scope and is `idle` without any), otherwise `run`. The same
 * rule as the Overview read hooks.
 */
const gateOf = (runs: boolean, subscribed: boolean): Gate => (!runs ? 'idle' : subscribed ? 'run' : 'paused');

export interface DomainListOptions extends ReadOptions {
  /** The rows asked for. */
  limit: number;
  /** Narrows the rows; the totals stay those of the scope. */
  roles?: readonly DomainRole[];
  /** Ask for the window before as well; it is read only while the scope compares. */
  compare?: boolean;
  include?: readonly DomainInclude[];
}

export interface SourceDomains {
  /** The rows of the window, and the meta (answers, units, engines, roles) of every row's denominator. */
  current: Read<SourceDomainPage>;
  /** Why nothing is read, when nothing is: the card says so and does not wait. */
  askable: SourcesAskable;
  /** The read asked for the window before, so a missing comparison can be told from one that was never wanted. */
  compared: boolean;
  /**
   * The totals of the window before, which a share change needs. `null` when it is not read: the comparison is off,
   * the window before had no answers (its units say nothing), or the window is not known yet.
   */
  previous: Read<SourcesMeta> | null;
}

/**
 * The domains of the scope by citation units, and, while the comparison is on, the units of the window before.
 * The window before is read for its totals only: one row, no role, and no placeholder, so a figure of the scope
 * before a change is never held against the rows of the scope after it.
 */
export function useSourceDomains({
  limit,
  roles = NO_ROLES,
  compare = false,
  include = NO_INCLUDE,
  subscribed = true,
}: DomainListOptions): SourceDomains {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const readScope = useMemo(() => ({ scope, enabledEngines }), [scope, enabledEngines]);
  const askable = sourcesAskable(readScope);
  const runs = askable === 'ok';
  const gate = gateOf(runs, subscribed);
  const compared = compare && comparisonWindow(scope) !== null;
  const ref = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const filters = useMemo(() => sourceFilters(readScope, roles), [readScope, roles]);
  const currentQuery = useQuery({
    ...sourceDomainsQuery(ref, filters, { limit, minSupport: MIN_DOMAIN_UNITS, compare: compared, include }),
    enabled: gate === 'run',
    placeholderData: keepPreviousData,
  });
  const current = useRead(currentQuery, gate);

  const meta = current.data?.meta;
  const before = meta?.compare_window ?? null;
  // While paused the window before keeps what it has (and is `idle` without it), so a card that shows rows keeps its changes
  const askBefore = runs && compared && before !== null && (meta?.previous_answers ?? 0) > 0;
  const beforeFilters = useMemo(
    () => ({ ...sourceFilters(readScope), from: before?.from ?? filters.from, to: before?.to ?? filters.to }),
    [readScope, before, filters.from, filters.to],
  );
  const beforeQuery = useQuery({
    ...sourceDomainsQuery(ref, beforeFilters, { limit: 1 }),
    enabled: askBefore && subscribed,
  });
  const beforeRead = useRead(beforeQuery, gateOf(askBefore, subscribed));
  const previous = useMemo(
    (): Read<SourcesMeta> | null => (askBefore ? { ...beforeRead, data: beforeRead.data?.meta } : null),
    [askBefore, beforeRead],
  );
  return useMemo(() => ({ current, askable, compared, previous }), [current, askable, compared, previous]);
}

const OWN_ONLY: readonly DomainRole[] = ['own'];

export interface PageListOptions extends ReadOptions {
  /** The rows asked for. */
  limit: number;
}

export interface SourcePages {
  /** The own pages of the window, and the meta (answers, units, engines, roles) of the scope. */
  current: Read<SourcePagePage>;
  /** Why nothing is read, when nothing is. */
  askable: SourcesAskable;
}

/**
 * The pages of the project's own domains that answers cite, by citation units (CH-08). The role is the page's own:
 * `meta` is the scope's whole, so a card can still say how many units the other roles hold. No comparison and no
 * minimum: one own page cited once is a page worth listing.
 */
export function useSourcePages({ limit, subscribed = true }: PageListOptions): SourcePages {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const readScope = useMemo(() => ({ scope, enabledEngines }), [scope, enabledEngines]);
  const askable = sourcesAskable(readScope);
  const gate = gateOf(askable === 'ok', subscribed);
  const ref = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const filters = useMemo(() => sourceFilters(readScope, OWN_ONLY), [readScope]);
  const query = useQuery({
    ...sourcePagesQuery(ref, filters, { limit }),
    enabled: gate === 'run',
    placeholderData: keepPreviousData,
  });
  const current = useRead(query, gate);
  return useMemo(() => ({ current, askable }), [current, askable]);
}

export interface ChangeListOptions extends ReadOptions {
  /** The rows asked for from each list. */
  limit: number;
  /** `false` leaves the lost list unread (it is `idle`): a card that needs only the new domains asks for one list. Default `true`. */
  lost?: boolean;
}

export interface SourceChanges {
  /** The domains new in the window; `page.total` is how many the route holds. */
  newer: Read<SourceChangePage>;
  /** The domains lost: cited before, not in the window or the one before it (docs/16 C6). */
  lost: Read<SourceChangePage>;
  /**
   * The valid answers of the window the new list compares with, whatever the scope compares: without them a domain
   * cannot be told new. `null` while the new list is not read (and so the window is not known).
   */
  before: Read<number> | null;
  /** Why nothing is read, when nothing is. */
  askable: SourcesAskable;
}

/**
 * The new and the lost domains of the scope, one request for each (WP-37 CH-22 and WB-OV-12), and the answers of the
 * window before. The route compares the window before on its own, so these reads do not depend on the scope's
 * comparison switch. `min_support` is asked of the route (default 2), not applied here.
 */
export function useSourceChanges({
  limit,
  lost: wantsLost = true,
  subscribed = true,
}: ChangeListOptions): SourceChanges {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const readScope = useMemo(() => ({ scope, enabledEngines }), [scope, enabledEngines]);
  const askable = sourcesAskable(readScope);
  const runs = askable === 'ok';
  const gate = gateOf(runs, subscribed);
  const ref = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const filters = useMemo(() => sourceFilters(readScope), [readScope]);
  const newQuery = useQuery({
    ...sourceChangesQuery(ref, filters, { kind: 'new', minSupport: MIN_DOMAIN_UNITS, limit }),
    enabled: gate === 'run',
    placeholderData: keepPreviousData,
  });
  const lostQuery = useQuery({
    ...sourceChangesQuery(ref, filters, { kind: 'lost', minSupport: MIN_DOMAIN_UNITS, limit }),
    enabled: gate === 'run' && wantsLost,
    placeholderData: keepPreviousData,
  });
  const newer = useRead(newQuery, gate);
  const lost = useRead(lostQuery, wantsLost ? gate : 'idle');

  const compareWindow = newer.data?.meta.compare_window ?? null;
  const askBefore = runs && compareWindow !== null;
  const beforeFilters = useMemo(
    () => ({ ...filters, from: compareWindow?.from ?? filters.from, to: compareWindow?.to ?? filters.to }),
    [filters, compareWindow],
  );
  const beforeQuery = useQuery({
    ...sourceDomainsQuery(ref, beforeFilters, { limit: 1 }),
    enabled: askBefore && subscribed,
  });
  const beforeRead = useRead(beforeQuery, gateOf(askBefore, subscribed));
  const before = useMemo(
    (): Read<number> | null => (askBefore ? mapRead(beforeRead, (page) => page.meta.answers) : null),
    [askBefore, beforeRead],
  );
  return useMemo(() => ({ newer, lost, before, askable }), [newer, lost, before, askable]);
}

export interface SourceDiversityRead {
  /** Per engine its totals and its weekly points, and the domains cited over every engine. */
  current: Read<SourceDiversity>;
  /** Why nothing is read, when nothing is. */
  askable: SourcesAskable;
}

const DIVERSITY = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/diversity' as const;

/**
 * The diversity route with its weekly series (lease L5 of the plan, taken without touching `lib/citations`: the
 * request is built here from the library's own filter helpers). The route has no role filter and the flagged
 * citations stay left out, as everywhere in the family. The new and lost card reads it too, for the domains cited.
 */
const diversityQuery = (
  scope: { workspaceId: string; projectId: string },
  filters: ReturnType<typeof sourceFilters>,
): ApiQueryOptions<typeof DIVERSITY> =>
  apiQuery(DIVERSITY, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
      query: { ...filterParams({ ...filters, roles: [] }), ...flagParams(filters), include: ['series'] },
    },
  });

/** The weekly source diversity of every engine in scope (CH-26). Two cards that ask it are one request. */
export function useSourceDiversity({ subscribed = true }: ReadOptions = {}): SourceDiversityRead {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const readScope = useMemo(() => ({ scope, enabledEngines }), [scope, enabledEngines]);
  const askable = sourcesAskable(readScope);
  const gate = gateOf(askable === 'ok', subscribed);
  const ref = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const filters = useMemo(() => sourceFilters(readScope), [readScope]);
  const query = useQuery({
    ...diversityQuery(ref, filters),
    enabled: gate === 'run',
    placeholderData: keepPreviousData,
  });
  const current = useRead(query, gate);
  return useMemo(() => ({ current, askable }), [current, askable]);
}
