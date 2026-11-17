import type { EdgeScope, LinkScope, Placement } from './scopes';
import { tierPosition, type TierNameLike } from './tiers';

/**
 * Which cards, stubs and group cards the journey canvas shows, and which rows the tree list shows (spec 7.5, the
 * mock's il-journey-layout.js). Each link of an opened card is one of three kinds: a new page (a card in the next
 * column), a back link (a page earlier on the card's own path: counted on the card, never a card) or a page seen
 * elsewhere (a stub that points at the original). Lists load lazily: the layout asks `lookup` for each list it
 * needs, records the request, and draws a `loading` item until it arrives.
 */

export const PER_CARD = 8;
export const MAX_CARDS = 300;
export const MAX_STEPS = 12;
/** The API's largest `limit` on neighbors. */
export const READ_LIMIT = 50;
export const FOCUS_KEY = 'f';

export type Direction = 'out' | 'in';

/** What the layout reads of a neighbor (the API's `Neighbor` satisfies it). */
export interface JourneyNeighbor {
  url_id: string;
  path: string;
  title: string | null;
  status_code: number | null;
  redirect_url_id: string | null;
  tier: TierNameLike | null;
  linking_pages: number;
  linking_pages_all: number;
  click_depth: number | null;
  anchor: string | null;
  placement: Placement | null;
  scope: EdgeScope | null;
  rel: readonly string[];
  is_followed: boolean;
  has_children: boolean;
  reciprocal: boolean;
}

/** One list: a page's links on one side in one scope, `pages` reads of `READ_LIMIT` from offset 0. */
export interface ListRequest {
  urlId: string;
  direction: Direction;
  scope: LinkScope;
  pages: number;
}

export interface LoadedList<N> {
  status: 'loading' | 'error' | 'ready';
  /** The rows of every page read so far, in the API's order. */
  items: readonly N[];
  total: number;
  otherScopes: readonly { scope: EdgeScope; pages: number }[];
  /** Ready with the pages read so far while a later page is still arriving (or failed): keys are not judged stale yet. */
  partial?: boolean;
}

export type ListLookup<N> = (request: ListRequest) => LoadedList<N>;

export interface JourneyState {
  focus: string;
  scope: LinkScope;
  open: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  more: ReadonlyMap<string, number>;
}

export interface Placed {
  dir: Direction;
  step: number;
}

export interface BackLink<N> {
  urlId: string;
  /** The key of the earlier card on this card's path (`FOCUS_KEY` for the focus). */
  key: string;
  node: N;
}

export type JourneyItem<N> =
  | { kind: 'head'; parentKey: string; urlId: string }
  | { kind: 'tierhead'; tier: TierNameLike | null; count: number }
  | {
      kind: 'card';
      key: string;
      urlId: string;
      node: N;
      parentKey: string;
      dir: Direction;
      step: number;
      canOpen: boolean;
      open: boolean;
      bothWays: boolean;
      /** Links of an opened card to pages earlier on its path; empty while closed. */
      backs: readonly BackLink<N>[];
    }
  | { kind: 'stub'; key: string; urlId: string; node: N; parentKey: string; dir: Direction; at: Placed }
  | {
      kind: 'group';
      key: string;
      scope: EdgeScope | 'both';
      count: number;
      open: boolean;
      parentKey: string;
      dir: Direction;
    }
  | { kind: 'more'; key: string; parentKey: string; count: number }
  | { kind: 'loading'; key: string; parentKey: string }
  | { kind: 'failed'; key: string; parentKey: string; request: ListRequest };

export interface JourneyColumn<N> {
  step: number;
  items: JourneyItem<N>[];
}

export interface JourneyLayout<N> {
  out: JourneyColumn<N>[];
  in: JourneyColumn<N>[];
  cardCount: number;
  requests: ListRequest[];
  /** Every key the layout can show: opened, group and more keys outside it are stale. */
  validKeys: ReadonlySet<string>;
  /** A list is loading or failed: the cards below it are unknown, so stale keys are not judged yet. */
  pending: boolean;
}

const side = (dir: Direction): string => (dir === 'out' ? 'o' : 'i');
export const cardKey = (dir: Direction, ids: readonly string[]): string => `${side(dir)}:${ids.join('.')}`;
export const groupKey = (dir: Direction, parentKey: string, scope: EdgeScope | 'both'): string =>
  `g:${side(dir)}:${parentKey}:${scope}`;
export const moreKey = (owner: string): string => `m:${owner}`;

/** Code unit order, never the locale's, so a server render, the browser and a shared link agree. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Url ids are 64 bit integers as strings: the shorter is the smaller, then digit by digit. */
const compareIds = (a: string, b: string): number => a.length - b.length || compareText(a, b);

/** Tier first (Untiered last), then the best linked, then the path, then the id (decision W8: no equity). */
export const compareChildren = (a: JourneyNeighbor, b: JourneyNeighbor): number =>
  tierPosition(a.tier) - tierPosition(b.tier) ||
  b.linking_pages_all - a.linking_pages_all ||
  compareText(a.path, b.path) ||
  compareIds(a.url_id, b.url_id);

const readsFor = (shown: number): number => Math.max(1, Math.ceil(shown / READ_LIMIT));
const isStepOneOut = (placed: Placed | undefined): boolean => placed?.dir === 'out' && placed.step === 1;

interface Parent {
  key: string;
  urlId: string;
  /** Url ids from the focus to this page, both included. */
  path: readonly string[];
  /** The card keys of `path`, `FOCUS_KEY` first. */
  keys: readonly string[];
}

export const isFull = (layout: Pick<JourneyLayout<unknown>, 'cardCount'>): boolean => layout.cardCount >= MAX_CARDS;

export function buildJourney<N extends JourneyNeighbor>(state: JourneyState, lookup: ListLookup<N>): JourneyLayout<N> {
  const placed = new Map<string, Placed>();
  const requests = new Map<string, ListRequest>();
  const validKeys = new Set<string>([FOCUS_KEY]);
  let cardCount = 1;
  let pending = false;

  const read = (urlId: string, direction: Direction, scope: LinkScope, pages: number): LoadedList<N> => {
    const id = `${urlId}|${direction}|${scope}`;
    const known = requests.get(id);
    if (known === undefined || known.pages < pages) requests.set(id, { urlId, direction, scope, pages });
    const list = lookup({ urlId, direction, scope, pages: Math.max(pages, known?.pages ?? 0) });
    // A failed list hides the cards below it just as a loading one does: their keys must survive until Try again
    if (list.status !== 'ready' || list.partial === true) pending = true;
    return list;
  };
  const moreOf = (key: string): number => state.more.get(key) ?? 0;

  const sides: Record<Direction, JourneyColumn<N>[]> = { out: [], in: [] };
  for (const dir of ['out', 'in'] as const) {
    let current: Parent[] = [{ key: FOCUS_KEY, urlId: state.focus, path: [state.focus], keys: [FOCUS_KEY] }];
    for (let step = 1; step <= MAX_STEPS && current.length > 0; step += 1) {
      const items: JourneyItem<N>[] = [];
      const next: Parent[] = [];
      for (const parent of current) {
        if (parent.key !== FOCUS_KEY && !state.open.has(parent.key)) continue;
        const free = (candidate: N): boolean =>
          candidate.url_id !== parent.urlId && !parent.path.includes(candidate.url_id);

        // One page shows once under a parent, whichever scope list names it, so no key is made twice
        const seen = new Set<string>();
        const emit = (nodes: readonly N[], owner: string, unloaded: number): void => {
          const key = moreKey(owner);
          validKeys.add(key);
          const limit = PER_CARD * (1 + moreOf(key));
          const fresh = nodes.filter((node) => !seen.has(node.url_id));
          for (const node of fresh) seen.add(node.url_id);
          const sorted = [...new Map(fresh.map((node) => [node.url_id, node])).values()].sort(compareChildren);
          let shown = 0;
          for (const child of sorted.slice(0, limit)) {
            // The canvas holds MAX_CARDS: the rest waits behind "+N more", which the canvas refuses with a message
            if (cardCount >= MAX_CARDS) break;
            shown += 1;
            const childKey = cardKey(dir, [...parent.path.slice(1), child.url_id]);
            validKeys.add(childKey);
            const at = placed.get(child.url_id);
            // A page that links both ways with the focus is a card on both sides (marked Both ways), not a stub
            const twoWay = dir === 'in' && parent.key === FOCUS_KEY && isStepOneOut(at);
            if (at !== undefined && !twoWay) {
              items.push({
                kind: 'stub',
                key: childKey,
                urlId: child.url_id,
                node: child,
                parentKey: parent.key,
                dir,
                at,
              });
              continue;
            }
            if (!twoWay) placed.set(child.url_id, { dir, step });
            const canOpen = child.has_children && step < MAX_STEPS;
            const open = canOpen && state.open.has(childKey);
            const path = [...parent.path, child.url_id];
            const keys = [...parent.keys, childKey];
            let backs: BackLink<N>[] = [];
            if (open) {
              // shortcut: back links are counted among the loaded neighbors (50 a request), upgrade when the API answers back links (gap G4)
              const own = read(
                child.url_id,
                dir,
                state.scope,
                readsFor(PER_CARD * (1 + moreOf(moreKey(`${side(dir)}|${childKey}`)))),
              );
              backs = own.items
                .filter((link) => parent.path.includes(link.url_id))
                .map((link) => ({
                  urlId: link.url_id,
                  key: keys[path.indexOf(link.url_id)] ?? FOCUS_KEY,
                  node: link,
                }));
            }
            items.push({
              kind: 'card',
              key: childKey,
              urlId: child.url_id,
              node: child,
              parentKey: parent.key,
              dir,
              step,
              canOpen,
              open,
              bothWays: child.reciprocal,
              backs,
            });
            if (open) next.push({ key: childKey, urlId: child.url_id, path, keys });
            cardCount += 1;
          }
          const remaining = sorted.length - shown + unloaded;
          if (remaining > 0) items.push({ kind: 'more', key, parentKey: parent.key, count: remaining });
        };

        const owner = `${side(dir)}|${parent.key}`;
        const firstIn = dir === 'in' && parent.key === FOCUS_KEY;
        // The first in column caps per tier on what is loaded; its own "+N more" reads the next 50
        const pages = firstIn ? 1 + moreOf(moreKey(owner)) : readsFor(PER_CARD * (1 + moreOf(moreKey(owner))));
        const list = read(parent.urlId, dir, state.scope, pages);
        items.push({ kind: 'head', parentKey: parent.key, urlId: parent.urlId });
        if (list.status === 'loading') {
          items.push({ kind: 'loading', key: `l:${owner}`, parentKey: parent.key });
          continue;
        }
        if (list.status === 'error') {
          items.push({
            kind: 'failed',
            key: `e:${owner}`,
            parentKey: parent.key,
            request: { urlId: parent.urlId, direction: dir, scope: state.scope, pages },
          });
          continue;
        }
        const children = list.items.filter(free);
        const unloaded = Math.max(0, list.total - list.items.length);
        const groups = state.scope === 'all' ? [] : list.otherScopes.filter((group) => group.pages > 0);
        if (children.length === 0 && unloaded === 0 && groups.length === 0) {
          items.pop();
          continue;
        }
        if (firstIn) {
          const both = children.filter((child) => isStepOneOut(placed.get(child.url_id)));
          const rest = children.filter((child) => !both.includes(child));
          if (both.length > 0) {
            const key = groupKey('in', FOCUS_KEY, 'both');
            validKeys.add(key);
            const open = state.groups.has(key);
            items.push({ kind: 'group', key, scope: 'both', count: both.length, open, parentKey: FOCUS_KEY, dir });
            if (open) emit(both, key, 0);
          }
          const byTier = new Map<number, N[]>();
          for (const child of rest) {
            const position = tierPosition(child.tier);
            byTier.set(position, [...(byTier.get(position) ?? []), child]);
          }
          for (const position of [...byTier.keys()].sort((a, b) => a - b)) {
            const members = byTier.get(position) ?? [];
            items.push({ kind: 'tierhead', tier: members[0]?.tier ?? null, count: members.length });
            emit(members, `${owner}|t${String(position)}`, 0);
          }
          const loadKey = moreKey(owner);
          validKeys.add(loadKey);
          if (unloaded > 0) items.push({ kind: 'more', key: loadKey, parentKey: parent.key, count: unloaded });
        } else {
          emit(children, owner, unloaded);
        }
        for (const group of groups) {
          const key = groupKey(dir, parent.key, group.scope);
          validKeys.add(key);
          const open = state.groups.has(key);
          items.push({ kind: 'group', key, scope: group.scope, count: group.pages, open, parentKey: parent.key, dir });
          if (!open) continue;
          const groupPages = readsFor(PER_CARD * (1 + moreOf(moreKey(key))));
          const members = read(parent.urlId, dir, group.scope, groupPages);
          if (members.status === 'loading') items.push({ kind: 'loading', key: `l:${key}`, parentKey: parent.key });
          else if (members.status === 'error') {
            items.push({
              kind: 'failed',
              key: `e:${key}`,
              parentKey: parent.key,
              request: { urlId: parent.urlId, direction: dir, scope: group.scope, pages: groupPages },
            });
          } else emit(members.items.filter(free), key, Math.max(0, members.total - members.items.length));
        }
      }
      if (!items.some((item) => item.kind !== 'head')) break;
      sides[dir].push({ step, items });
      current = next;
    }
  }
  return { out: sides.out, in: sides.in, cardCount, requests: [...requests.values()], validKeys, pending };
}

/**
 * The opened cards, groups and counts that still exist once every list has loaded; `null` when nothing is stale
 * (or a list is still loading, so a key cannot be judged yet). A card that closes takes its descendants' keys
 * with it this way.
 */
export function pruneJourney(
  state: Pick<JourneyState, 'open' | 'groups' | 'more'>,
  layout: Pick<JourneyLayout<unknown>, 'validKeys' | 'pending'>,
): { open: Set<string>; groups: Set<string>; more: Map<string, number> } | null {
  if (layout.pending) return null;
  const open = new Set([...state.open].filter((key) => layout.validKeys.has(key)));
  const groups = new Set([...state.groups].filter((key) => layout.validKeys.has(key)));
  const more = new Map([...state.more].filter(([key]) => layout.validKeys.has(key)));
  const same = open.size === state.open.size && groups.size === state.groups.size && more.size === state.more.size;
  return same ? null : { open, groups, more };
}

export type TreeRow<N> =
  | {
      kind: 'page';
      key: string;
      level: number;
      urlId: string;
      node: N | null;
      canOpen: boolean;
      open: boolean;
      bothWays: boolean;
    }
  | { kind: 'back'; key: string; level: number; urlId: string; node: N; step: number }
  | { kind: 'listed'; key: string; level: number; urlId: string; node: N }
  | { kind: 'loading'; key: string; level: number }
  | { kind: 'failed'; key: string; level: number; request: ListRequest }
  | { kind: 'more'; key: string; level: number; count: number };

/**
 * The tree list (spec 7.5): one direction, rows in reading order. A link to a page earlier on the row's path is a
 * muted "Links back to" row, a page shown higher in the tree is "listed above"; neither expands. Each opened row
 * reads one page of 50 links; more than that is one muted "more" row.
 */
export function buildTree<N extends JourneyNeighbor>(
  input: { focus: string; dir: Direction; scope: LinkScope; open: ReadonlySet<string> },
  lookup: ListLookup<N>,
): { rows: TreeRow<N>[]; requests: ListRequest[]; pending: boolean } {
  const rows: TreeRow<N>[] = [];
  const requests: ListRequest[] = [];
  const listed = new Set<string>();
  let pending = false;

  const walk = (urlId: string, key: string, level: number, node: N | null, path: readonly string[]): void => {
    listed.add(urlId);
    const open = level === 0 || input.open.has(key);
    const canOpen = level === 0 || (node !== null && node.has_children && level < MAX_STEPS);
    rows.push({
      kind: 'page',
      key,
      level,
      urlId,
      node,
      canOpen,
      open: open && canOpen,
      bothWays: node?.reciprocal ?? false,
    });
    if (!open || !canOpen) return;
    const request: ListRequest = { urlId, direction: input.dir, scope: input.scope, pages: 1 };
    requests.push(request);
    const list = lookup(request);
    if (list.status === 'loading') {
      pending = true;
      rows.push({ kind: 'loading', key: `${key}.loading`, level: level + 1 });
      return;
    }
    if (list.status === 'error') {
      rows.push({ kind: 'failed', key: `${key}.failed`, level: level + 1, request });
      return;
    }
    // One page shows once under a row, so no row key is made twice
    const children = [...new Map(list.items.map((item) => [item.url_id, item])).values()].sort(compareChildren);
    let skipped = 0;
    for (const child of children) {
      if (child.url_id === urlId) continue;
      // The tree holds as many rows as the canvas holds cards; the rest waits behind one "more" row
      if (rows.length >= MAX_CARDS) {
        skipped += 1;
        continue;
      }
      const childKey = `${key}.${child.url_id}`;
      if (path.includes(child.url_id)) {
        rows.push({
          kind: 'back',
          key: childKey,
          level: level + 1,
          urlId: child.url_id,
          node: child,
          step: path.indexOf(child.url_id),
        });
      } else if (listed.has(child.url_id)) {
        rows.push({ kind: 'listed', key: childKey, level: level + 1, urlId: child.url_id, node: child });
      } else {
        walk(child.url_id, childKey, level + 1, child, [...path, child.url_id]);
      }
    }
    const unloaded = Math.max(0, list.total - list.items.length) + skipped;
    if (unloaded > 0) rows.push({ kind: 'more', key: `${key}.more`, level: level + 1, count: unloaded });
  };

  walk(input.focus, 't', 0, null, [input.focus]);
  return { rows, requests, pending };
}
