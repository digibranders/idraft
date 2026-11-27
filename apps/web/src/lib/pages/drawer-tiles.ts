import type { IssueSeverity, PageIssue, Seam } from './issue-source';
import type { PageDrawerTab } from './drawer-tabs';
import type { PageDetail } from '@/lib/internal-links/types';

export type DrawerTileId =
  'clicks' | 'impressions' | 'keywords' | 'citations' | 'linksIn' | 'linksOut' | 'depth' | 'issues';

/** `ok` has a number; the others have none and say why: never a 0 for what is not known. */
export type DrawerTileState = 'ok' | 'not_connected' | 'pending' | 'unreachable' | 'error';

/** What a tile's second line says, as data: the words are the component's. */
export type DrawerTileNote =
  | { kind: 'none' }
  | { kind: 'last28' }
  | { kind: 'bestRank'; rank: number }
  | { kind: 'noRank' }
  | { kind: 'links'; all: number }
  | { kind: 'depth' }
  | { kind: 'issues'; severity: IssueSeverity; count: number }
  | { kind: 'issuesNone' };

export interface DrawerTile {
  id: DrawerTileId;
  value: number | null;
  state: DrawerTileState;
  note: DrawerTileNote;
  /** The tab the tile opens. */
  tab: PageDrawerTab;
}

/** Most severe first. */
const SEVERITY_ORDER: readonly IssueSeverity[] = ['error', 'warning', 'notice'];

/** The issues of one page, most severe first. */
export const sortIssues = (issues: readonly PageIssue[]): PageIssue[] =>
  [...issues].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

function searchTile(id: 'clicks' | 'impressions', gsc: PageDetail['extras']['gsc']): DrawerTile {
  const value = id === 'clicks' ? gsc.clicks : gsc.impressions;
  if (gsc.state === 'ok' && value !== null) return { id, value, state: 'ok', note: { kind: 'last28' }, tab: 'search' };
  // An answer without a number reads as not collected, never as 0
  return {
    id,
    value: null,
    state: gsc.state === 'not_connected' ? 'not_connected' : 'pending',
    note: { kind: 'none' },
    tab: 'search',
  };
}

function issuesTile(issues: Seam<readonly PageIssue[]>): DrawerTile | null {
  if (issues.state === 'unavailable') return null;
  // A failed read is not "not collected yet": it says so, and the Issues tab it opens has the retry
  if (issues.state === 'error') {
    return { id: 'issues', value: null, state: 'error', note: { kind: 'none' }, tab: 'issues' };
  }
  if (issues.state === 'loading') {
    return { id: 'issues', value: null, state: 'pending', note: { kind: 'none' }, tab: 'issues' };
  }
  const [worst] = sortIssues(issues.data);
  if (worst === undefined) {
    return { id: 'issues', value: 0, state: 'ok', note: { kind: 'issuesNone' }, tab: 'issues' };
  }
  const count = issues.data.filter((issue) => issue.severity === worst.severity).length;
  return {
    id: 'issues',
    value: count,
    state: 'ok',
    note: { kind: 'issues', severity: worst.severity, count },
    tab: 'issues',
  };
}

/** The tiles of the drawer's Overview in the order of spec 9.4: eight, or seven while the Issues seam is unavailable. */
export function drawerTiles(detail: PageDetail, issues: Seam<readonly PageIssue[]>): DrawerTile[] {
  const { page, extras } = detail;
  const ranks = extras.keywords.flatMap((keyword) => (keyword.rank === null ? [] : [keyword.rank]));
  const tiles: (DrawerTile | null)[] = [
    searchTile('clicks', extras.gsc),
    searchTile('impressions', extras.gsc),
    {
      id: 'keywords',
      value: extras.keywords.length,
      state: 'ok',
      note: ranks.length === 0 ? { kind: 'noRank' } : { kind: 'bestRank', rank: Math.min(...ranks) },
      tab: 'search',
    },
    { id: 'citations', value: extras.citations.total, state: 'ok', note: { kind: 'last28' }, tab: 'ai' },
    {
      id: 'linksIn',
      value: page.linking_pages,
      state: 'ok',
      note: { kind: 'links', all: page.linking_pages_all },
      tab: 'links',
    },
    {
      id: 'linksOut',
      value: page.outlinks,
      state: 'ok',
      note: { kind: 'links', all: page.outlinks_all },
      tab: 'links',
    },
    page.click_depth === null
      ? { id: 'depth', value: null, state: 'unreachable', note: { kind: 'none' }, tab: 'links' }
      : { id: 'depth', value: page.click_depth, state: 'ok', note: { kind: 'depth' }, tab: 'links' },
    issuesTile(issues),
  ];
  return tiles.filter((tile): tile is DrawerTile => tile !== null);
}
