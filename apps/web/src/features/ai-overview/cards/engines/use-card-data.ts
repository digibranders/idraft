'use client';

import { useCallback, useMemo } from 'react';

import { buildAggregates, type OverviewAggregates } from '../../data/aggregates';
import { askedEngines, type SummaryOptions } from '../../data/overview-queries';
import type { Read } from '../../data/read-state';
import {
  useOverviewPeriods as readPeriods,
  useOverviewSources as readSources,
  type OverviewEngines,
  type OverviewReadInput,
  type OverviewSourcesMeta,
} from '../../data/use-overview-reads';
import { useOverview, type OverviewProject } from '../../overview-context';
import type { OverviewScope } from '../../scope/scope-model';
import { cardPhase, type CardPhase, type PreviousNeed } from './card-phase';
import { inCatalogOrder } from './engine-role';
import type { EngineCode, PromptsSummary } from '@/lib/api/types';

export interface CardDataOptions {
  /** Whether the card reads the window before, and whether it can show without it. */
  previous: PreviousNeed;
  /** Blocks to add to the summary (a point per week, a cell per tracked entity). */
  include?: SummaryOptions['include'];
  /** Read the citation units by role, which the own citation share of each engine is made from. */
  sources?: boolean;
  /**
   * The card passes the `live` of its `CardProps`. While `false` (customize mode) no read of the card asks anything:
   * it shows what it already has for the scope, and a card with nothing yet stays `loading`, as it is not "no engine".
   */
  subscribed?: boolean;
}

export interface CardData {
  scope: OverviewScope;
  project: OverviewProject;
  workspaceSlug: string;
  /** The engines the card shows: on in the project and inside the page's engine filter, in catalog order. */
  asked: readonly EngineCode[];
  engines: OverviewEngines;
  current: Read<PromptsSummary>;
  /**
   * The window before, only while it answers for the same scope as the current one (`comparing`); `null` when the
   * comparison is off, not read, not paired yet, or failed (`partialPrevious` says that).
   */
  previous: Read<PromptsSummary> | null;
  /**
   * A change between the windows may be drawn: the two reads are of one scope. It stays true while the same scope is
   * read again in the background (the values stay on screen), and is false on a scope change until both answer.
   */
  comparing: boolean;
  /** The card reads (`subscribed` of the options): the reads that extend this card's own (a trend's schedule) follow it. */
  subscribed: boolean;
  /** The figures of the strip, from the same prompt rows; `null` until the summary and the engines are read. */
  aggregates: OverviewAggregates | null;
  /** The sources read, when the card asked for it. */
  sources: Read<OverviewSourcesMeta> | null;
  phase: CardPhase;
  /** The figures shown are the last that were read: a later read of them failed. */
  stale: boolean;
  /** The previous window could not be read on a card that shows without it. */
  partialPrevious: boolean;
  errorId: string | null;
  /** Reads again what failed (and the current window). */
  retry: () => void;
  canManageEngines: boolean;
  canViewRuns: boolean;
}

/**
 * Every read of a card of the engines family and what the card says about them (WP-34 plan T0). It is the only
 * place a card meets the data hooks, so that the swap of the summary for the aggregate routes of WP-32 changes this
 * file and the models. A card that needs no previous window reads one summary; the previous window is a second
 * request that is dropped, with its change, while the two reads are not of the same scope.
 */
export function useCardData({
  previous: need,
  include,
  sources = false,
  subscribed = true,
}: CardDataOptions): CardData {
  const { workspaceId, workspaceSlug, project, scope, enabledEngines, engines, canManageEngines, canViewRuns } =
    useOverview();
  const ref = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  // The comparison is not part of a summary's key, so a card that needs no previous window shares the page's read
  const periodScope = useMemo(() => (need === 'none' ? { ...scope, compare: false } : scope), [need, scope]);
  const periods = readPeriods(
    { project: ref, scope: periodScope, enabledEngines },
    include === undefined ? { subscribed } : { include, subscribed },
  );
  // With no engine named the sources read does not run: a card that did not ask for it costs no request
  const sourcesInput: OverviewReadInput = { project: ref, scope, enabledEngines: sources ? enabledEngines : [] };
  const sourcesRead = readSources(sourcesInput, { subscribed });

  const asked = useMemo(() => inCatalogOrder(askedEngines({ scope, enabledEngines })), [scope, enabledEngines]);
  // `paired` is true for a read of the same scope again, so the change between the windows stays drawn then; a scope
  // change (a read that holds the last scope's data) is not paired, so no change is built from two scopes
  const comparing = periods.paired && periods.previous !== null;
  const currentData = periods.current.data;
  const previousData = comparing ? (periods.previous?.data ?? null) : null;
  // The sources of the last scope are not the figures of this one: they are left out until this scope's arrive
  const sourcesData = sources && !sourcesRead.placeholder ? (sourcesRead.data ?? null) : null;
  const aggregates = useMemo(
    () =>
      currentData === undefined || engines.data === undefined
        ? null
        : buildAggregates({
            current: currentData,
            previous: previousData,
            engines: engines.data,
            chosenEngines: scope.engines,
            topicsKept: null,
            sources: sourcesData,
            fanout: null,
          }),
    [currentData, previousData, engines.data, scope.engines, sourcesData],
  );
  const hasContent = aggregates !== null && (!aggregates.rowsRead || (aggregates.promptCount ?? 0) > 0);
  const state = cardPhase({
    current: periods.current,
    previous: periods.previous,
    need,
    settled: periods.settled,
    hasContent,
  });
  // The engines come first: until they are known no read runs, which is waiting and not an empty card; when they
  // cannot be read every read is idle, which is a failure of the card and not "no engine is on". A paused card with
  // nothing read yet has an idle read too, though an engine is asked: it is waiting for its turn, not empty.
  const pausedWithNothing = !subscribed && asked.length > 0 && periods.current.status === 'idle';
  const phase: CardPhase =
    engines.status === 'loading' || pausedWithNothing ? 'loading' : engines.status === 'error' ? 'error' : state.phase;

  const currentRefetch = periods.current.refetch;
  const previousFailed = periods.previous?.status === 'error';
  const previousRefetch = periods.previous?.refetch;
  const enginesFailed = engines.status === 'error';
  const enginesRefetch = engines.refetch;
  const retry = useCallback((): void => {
    if (enginesFailed) enginesRefetch();
    currentRefetch();
    if (previousFailed) previousRefetch?.();
  }, [enginesFailed, enginesRefetch, currentRefetch, previousFailed, previousRefetch]);

  const errorId =
    (enginesFailed ? engines.errorId : null) ??
    periods.current.errorId ??
    (need === 'required' ? (periods.previous?.errorId ?? null) : null);
  return {
    scope,
    project,
    workspaceSlug,
    asked,
    engines,
    current: periods.current,
    previous: comparing ? periods.previous : null,
    comparing,
    subscribed,
    aggregates,
    sources: sources ? sourcesRead : null,
    phase,
    stale: state.stale,
    partialPrevious: state.partialPrevious,
    errorId,
    retry,
    canManageEngines,
    canViewRuns,
  };
}
