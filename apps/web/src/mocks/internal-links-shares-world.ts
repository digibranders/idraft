import { changeLinks, changesSummary, worklistCounts } from './internal-links-changes-world';
import { alertSettingsOf, HOST, runViewOf, tierFlow, worklists } from './internal-links-world';
import { onMockReset } from './state';
import type { ClientSummary, CreatedShare, ExpiryDays, Share, ShareState } from '@/lib/internal-links/types';

/**
 * The client summary links of the mock API: made, listed and revoked per project, and the public summary a token
 * opens. Like every mock state it lives in the memory of one page session and starts again on a reset. A token is
 * kept as made (the API keeps only its hash), and is answered once, by the create.
 */

const DAY_MS = 86_400_000;
/** The token that always answers 429, so a screen and its tests can show the wait. */
export const RATE_LIMITED_TOKEN = 'rate-limited-token';
const SUMMARY_LOST_LIMIT = 20;

interface StoredShare {
  id: string;
  project_id: string;
  token: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

let shares: StoredShare[] = [];
let counter = 0;
onMockReset(() => {
  shares = [];
  counter = 0;
});

const stateOf = (share: StoredShare, now: number): ShareState =>
  share.revoked_at !== null ? 'revoked' : Date.parse(share.expires_at) <= now ? 'expired' : 'active';

function viewOf(share: StoredShare, now: number): Share {
  return {
    id: share.id,
    created_at: share.created_at,
    created_by: share.created_by,
    expires_at: share.expires_at,
    revoked_at: share.revoked_at,
    state: stateOf(share, now),
  };
}

const hex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The project's links, newest first, without their tokens. */
export function sharesOf(projectId: string, now = Date.now()): Share[] {
  return shares
    .filter((share) => share.project_id === projectId)
    .map((share) => viewOf(share, now))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createShare(projectId: string, userId: string, days: ExpiryDays, now = Date.now()): CreatedShare {
  counter += 1;
  const share: StoredShare = {
    // Ids sort in the order they were made
    id: `0192e4a0-a000-7000-8000-${String(counter).padStart(12, '0')}`,
    project_id: projectId,
    token: hex(24),
    created_by: userId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + days * DAY_MS).toISOString(),
    revoked_at: null,
  };
  shares = [...shares, share];
  return { ...viewOf(share, now), token: share.token };
}

/** Revokes a link of the project; null for one the project does not have. Revoking twice changes nothing. */
export function revokeShare(projectId: string, shareId: string, now = Date.now()): Share | null {
  const share = shares.find((candidate) => candidate.id === shareId && candidate.project_id === projectId);
  if (share === undefined) return null;
  share.revoked_at ??= new Date(now).toISOString();
  return viewOf(share, now);
}

/** The project a token opens, or null for an unknown, expired or revoked one (the API tells them apart to nobody). */
export function projectOfToken(token: string, now = Date.now()): string | null {
  const share = shares.find((candidate) => candidate.token === token);
  return share !== undefined && stateOf(share, now) === 'active' ? share.project_id : null;
}

/** The client summary of the project's latest crawl, from the same reads the download makes. */
export function publicSummary(projectId: string): ClientSummary | null {
  const view = runViewOf(projectId, null);
  if (view === null) return null;
  const flow = tierFlow('editorial');
  const counts = worklistCounts(projectId, view, worklists());
  const changes = changesSummary(projectId, view);
  const links = view.run.links_available && changes.links_compared;
  const lost = links
    ? changeLinks(projectId, view, {
        change: 'lost',
        linkScope: 'editorial',
        only: 'top',
        offset: 0,
        limit: SUMMARY_LOST_LIMIT,
      })
    : null;
  return {
    pages_blocked: view.run.pages_blocked,
    crawled_at: view.run.finished_at,
    generated_at: new Date().toISOString(),
    host: new URL(HOST).host,
    important_max_position: alertSettingsOf(projectId).max_position,
    pages: flow.tiers.reduce((sum, stat) => sum + stat.pages, 0),
    tiers: flow.tiers.map((stat) => ({
      code: stat.tier?.code ?? null,
      name: stat.tier?.name ?? null,
      pages: stat.pages,
      average_depth: stat.average_depth,
    })),
    flow: flow.cells.map((cell) => ({
      from_code: cell.from_tier?.code ?? null,
      to_code: cell.to_tier?.code ?? null,
      links: cell.links,
    })),
    worklists: [
      { key: 'under_linked_t1', count: counts.under_linked_t1, may_be_incomplete: false },
      { key: 'orphans', count: counts.orphans, may_be_incomplete: false },
      { key: 'editorial_orphans', count: counts.editorial_orphans, may_be_incomplete: false },
      { key: 'deep_only_through_auto', count: counts.deep_only_through_auto, may_be_incomplete: false },
      { key: 'broken_and_redirected', count: counts.broken_and_redirected, may_be_incomplete: false },
      { key: 'links_to_non_indexable', count: counts.links_to_non_indexable, may_be_incomplete: false },
      { key: 'weak_outlinks', count: counts.weak_outlinks, may_be_incomplete: false },
    ],
    lost:
      lost === null
        ? { state: view.run.previous_run_id === null ? 'no_comparison' : 'dropped', total: null, links: [] }
        : {
            state: 'available',
            total: lost.meta.total,
            links: lost.data.map((link) => ({
              from_path: link.source.path,
              to_path: link.target.path,
              anchor: link.anchor,
            })),
          },
  };
}
