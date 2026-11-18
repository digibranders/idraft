import { depthMove, formatDelta, type Tone } from './changes-format';
import { pageChangeState } from './contract-states';
import type { ChangesState, CrawlRun, PageChange } from './types';

/**
 * Where the comparison with the previous crawl stands, for the Change column: `first_crawl` has no earlier crawl,
 * `updating` is still being worked out, `unavailable` failed, `ready` is done. The summary says first_crawl before
 * anything else; while it has not answered, the crawl's own enrichment state decides.
 */
export type Comparison = 'first_crawl' | 'updating' | 'unavailable' | 'ready';

export function comparisonOf(
  summary: ChangesState | undefined,
  enrich: CrawlRun['enrich_state'] | undefined,
): Comparison {
  if (summary === 'first_crawl') return 'first_crawl';
  if (summary === 'unavailable') return 'unavailable';
  if (summary === 'pending') return 'updating';
  if (summary === 'ready') return 'ready';
  if (enrich === 'done') return 'ready';
  return enrich === 'failed' ? 'unavailable' : 'updating';
}

export interface DepthPart {
  state: 'closer' | 'deeper' | 'lost' | 'found';
  /** Levels the page moved; 0 for a page that became reachable or unreachable. */
  levels: number;
}

export type ChangeParts =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'moved'; links: { text: string; tone: Tone } | null; depth: DepthPart | null };

/** A page's change as the column shows it. Links in and depth only: no equity figure is read. */
export function changeParts(change: PageChange): ChangeParts {
  const state = pageChangeState(change);
  if (state === 'new') return { kind: 'new' };
  if (state !== 'moved') return { kind: 'none' };
  const links = formatDelta(change.editorial_in_delta, 'in');
  const levels = depthMove(change);
  const depth: DepthPart | null =
    change.depth_state !== null
      ? { state: change.depth_state, levels: 0 }
      : levels > 0
        ? { state: (change.depth_delta ?? 0) < 0 ? 'closer' : 'deeper', levels }
        : null;
  return links === null && depth === null ? { kind: 'none' } : { kind: 'moved', links, depth };
}
