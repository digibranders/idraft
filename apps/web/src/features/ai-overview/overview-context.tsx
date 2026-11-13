'use client';

import { createContext, use, useMemo, type ReactElement, type ReactNode } from 'react';

import type { Read } from './data/read-state';
import {
  useOverviewEngines as readEngines,
  useOverviewFanout as readFanout,
  useOverviewPeriods as readPeriods,
  useOverviewSchedule as readSchedule,
  useOverviewSources as readSources,
  useOverviewSummary as readSummary,
  type OverviewEngines,
  type OverviewFanoutMeta,
  type OverviewPeriods,
  type OverviewReadInput,
  type OverviewSchedule,
  type OverviewSourcesMeta,
  type ReadOptions,
  type SourcesReadOptions,
  type SummaryReadOptions,
} from './data/use-overview-reads';
import { normalizeEngines, type OverviewScope, type ScopePatch } from './scope/scope-model';
import { useOverviewScope } from './scope/use-overview-scope';
import type { RangeProblem } from '@/components/app/date-range/range-model';
import type { EngineCode, PromptsSummary } from '@/lib/api/types';
import { useCan } from '@/lib/permissions';

/** The project the page is of, as the route gives it. */
export interface OverviewProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: the days of the window are its days. */
  timeZone: string;
  defaultLanguage: string | null;
  defaultCountryIso: string | null;
}

/** What the shell and every card of the AI visibility Overview know (WP-33 plan section 5, item 4). */
export interface OverviewContextValue {
  workspaceId: string;
  workspaceSlug: string;
  project: OverviewProject;
  /** The one scope a card may use; a card never reads the URL itself. */
  scope: OverviewScope;
  setScope: (patch: ScopePatch) => void;
  /** Why the link's range was not used; `null` when it was. */
  dropped: RangeProblem | null;
  /** The engines of the project and their read (the one request the layout capabilities make too). */
  engines: OverviewEngines;
  /** The engines that are on; empty while they load, and while that is so every read is `idle`. */
  enabledEngines: readonly EngineCode[];
  /** Whether the member may turn engines on (`projects:write`). */
  canManageEngines: boolean;
  /** Whether the member may be sent to the runs of the project. */
  canViewRuns: boolean;
}

const OverviewContext = createContext<OverviewContextValue | null>(null);

export interface OverviewProviderProps {
  workspaceId: string;
  workspaceSlug: string;
  project: OverviewProject;
  children: ReactNode;
}

/** The scope in the URL, the engines and the permissions of the page, for the shell and its cards. */
export function OverviewProvider({
  workspaceId,
  workspaceSlug,
  project,
  children,
}: OverviewProviderProps): ReactElement {
  const { scope: urlScope, dropped, setScope } = useOverviewScope({ project });
  const ref = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const engines = readEngines(ref);
  // Every engine that is on, chosen in any order, is no filter: the numbers and the scope bar see `null`, as the
  // address with no engine key says, so the same scope is never two scopes
  const scope = useMemo((): OverviewScope => {
    const normalized = normalizeEngines(urlScope.engines, engines.enabled);
    return normalized === urlScope.engines ? urlScope : { ...urlScope, engines: normalized };
  }, [urlScope, engines.enabled]);
  const canManageEngines = useCan('projects:write');
  const canTriggerRuns = useCan('runs:trigger');
  const canReadData = useCan('data:read');
  const value = useMemo(
    (): OverviewContextValue => ({
      workspaceId,
      workspaceSlug,
      project,
      scope,
      setScope,
      dropped,
      engines,
      enabledEngines: engines.enabled,
      canManageEngines,
      canViewRuns: canTriggerRuns || canReadData,
    }),
    [
      workspaceId,
      workspaceSlug,
      project,
      scope,
      setScope,
      dropped,
      engines,
      canManageEngines,
      canTriggerRuns,
      canReadData,
    ],
  );
  return <OverviewContext.Provider value={value}>{children}</OverviewContext.Provider>;
}

export function useOverview(): OverviewContextValue {
  const value = use(OverviewContext);
  if (value === null) throw new Error('useOverview is used outside an OverviewProvider');
  return value;
}

/**
 * The reads of the page bound to its scope (WP-33 plan section 3.3). A card calls these and never the API: the
 * same options are one request, and when the aggregate routes of WP-32 land only the data hooks change.
 */
function useReadInput(): OverviewReadInput {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  return useMemo(
    () => ({ project: { workspaceId, projectId: project.id }, scope, enabledEngines }),
    [workspaceId, project.id, scope, enabledEngines],
  );
}

/*
 * Every read below takes `{ subscribed }` (default true). A card passes the `subscribed` prop of its `CardProps`:
 * while it is false (customize mode, out of view) the read asks nothing and shows the data it has for the scope, or
 * is `idle` (see `ReadOptions` in ./data/use-overview-reads.ts).
 */
export const useOverviewSummary = (options?: SummaryReadOptions): Read<PromptsSummary> =>
  readSummary(useReadInput(), options);

export const useOverviewPeriods = (options?: SummaryReadOptions): OverviewPeriods =>
  readPeriods(useReadInput(), options);

export const useOverviewSources = (options?: SourcesReadOptions): Read<OverviewSourcesMeta> =>
  readSources(useReadInput(), options);

export const useOverviewFanout = (options?: ReadOptions): Read<OverviewFanoutMeta> =>
  readFanout(useReadInput(), options);

export function useOverviewSchedule(options?: ReadOptions): Read<OverviewSchedule> {
  const { workspaceId, project } = useOverview();
  return readSchedule({ workspaceId, projectId: project.id }, options);
}

/** The engines of the project and their read, from the provider (the same request the layout capabilities make). */
export const useOverviewEngines = (): OverviewEngines => useOverview().engines;
