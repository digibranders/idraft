'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { serpRows, type SerpRow } from './serp-rows';
import { normaliseObs, snapshotOptions, type SnapshotOption } from './snapshot-options';
import { serpCurrentQuery, snapshotQuery, snapshotsQuery } from '../detail-queries';
import { useDetailUrlState } from '../detail-url-state';
import type { KeywordScope } from '../../keyword-inspector/inspector-queries';

/**
 * Which SERP snapshot the tab shows and what it has read for it. `obs` in the address names a dated
 * snapshot; without it, or with the id of the latest check, the page shows the latest check, which
 * `serp-current` serves (its top 20 with titles). A dated snapshot is read from `serp-snapshots/{id}` with
 * its titles and the month hint of its row. The snapshot detail of the next task reads `shownId` and
 * `observedAt` from here, so both views of the tab agree on what is on show.
 */
export function useSnapshotView(scope: KeywordScope) {
  const { obs, setObs } = useDetailUrlState();
  const current = useQuery(serpCurrentQuery(scope));
  const list = useInfiniteQuery(snapshotsQuery(scope));

  const latestId = current.data?.data.serp_snapshot_id ?? null;
  const chosen = normaliseObs(obs, latestId);
  const loaded = useMemo(() => snapshotOptions(list.data?.pages.flatMap((page) => page.data) ?? []), [list.data]);
  const known = chosen === null ? null : (loaded.find((option) => option.id === chosen) ?? null);

  // Read once the latest check is known, so an obs equal to it never reads the same SERP twice
  const detail = useQuery({
    ...snapshotQuery(scope, chosen ?? '', known?.observedAt ?? null),
    enabled: chosen !== null && !current.isPending,
  });
  const dated = detail.data?.data ?? null;

  // A snapshot chosen by a link may be older than the pages loaded: its own read stands in for its row
  const options = useMemo((): SnapshotOption[] => {
    if (dated === null || loaded.some((option) => option.id === dated.serp_snapshot_id)) return loaded;
    return [
      ...loaded,
      {
        id: dated.serp_snapshot_id,
        observedAt: dated.observed_at,
        observedDate: dated.observed_date,
        depth: dated.depth_requested,
        depthReturned: dated.depth_returned,
        own: dated.own,
        urlChanged: false,
        hasAio: dated.has_ai_overview,
      },
    ];
  }, [loaded, dated]);

  const shownId = chosen ?? latestId;
  const shown = options.find((option) => option.id === shownId) ?? null;
  const results = chosen === null ? current.data?.data.results : dated?.organic;
  const rows = useMemo((): SerpRow[] | null => (results === undefined ? null : serpRows(results)), [results]);

  // How many results came back of how many asked for: from the snapshot's own read once it is there
  const asked =
    chosen === null
      ? shown
      : dated === null
        ? null
        : { depth: dated.depth_requested, depthReturned: dated.depth_returned };

  return {
    current,
    list,
    detail,
    options,
    latestId,
    /** The dated snapshot chosen; null when the latest check is on show. */
    chosen,
    /** The id of the snapshot on show: the chosen one, else the latest check's. */
    shownId,
    /** The picker's row of the snapshot on show, when its page is loaded. */
    shown,
    /** The depth asked for and the results returned, once known: fewer than asked is worth saying. */
    asked,
    /** When the snapshot on show was checked, once known. */
    observedAt:
      chosen === null ? (current.data?.data.observed_at ?? null) : (dated?.observed_at ?? known?.observedAt ?? null),
    /** Where the titles come from: null for the latest check, which carries its own. */
    titlesSource: chosen === null ? null : (dated?.titles_source ?? null),
    rows,
    choose: (id: string | null): void => void setObs(normaliseObs(id, latestId)),
  };
}
