/**
 * Internal links, Journey tab: the pure part (no DOM). It decides which cards the canvas shows and which rows the
 * tree list shows (spec 7.5). Each link of an opened card is one of three kinds: a new page (a card in the next
 * column), a back link (a page earlier on the card's own path: counted on the card, never a card) or a page seen
 * elsewhere (a stub that points at the original).
 */
import { depth, ins, outs, pageById, tierCode, tierIdOf, tierPosition, equity } from './il-model.js';

export const PER_CARD = 8;
export const MAX_CARDS = 300;
export const MAX_STEPS = 12;

export const other = (link, dir) => (dir === 'out' ? link.to : link.from);
export const markerScope = (cards) => (cards === 'all' ? 'all' : 'editorial');

/** Links of a page in a direction. A redirect has one link out: its target. */
export function linksOf(id, dir, scope) {
  const page = pageById(id);
  if (dir === 'out' && page.redirect) return [{ id: `redirect-${id}`, from: id, to: page.redirect, anchor: '301 redirect', placement: 'content', rel: 'follow' }];
  return dir === 'out' ? outs(id, scope) : ins(id, scope);
}

/** Children sort by tier position (Untiered last), then equity share. */
export const childSorter = (dir) => (a, b) => {
  const position = (link) => tierPosition(tierIdOf(pageById(other(link, dir)))) || 99;
  return position(a) - position(b) || equity[other(b, dir)] - equity[other(a, dir)];
};

const GROUP_SCOPES = ['auto', 'template'];
const scopeKey = (link) => (link.placement === 'content' ? 'editorial' : link.placement === 'auto_generated' ? 'auto' : 'template');

/** Back links of a card: links to pages earlier on its own path. */
export function backsOf(item, scope) {
  const earlier = item.path.slice(0, -1);
  return linksOf(item.id, item.dir, scope)
    .filter((link) => earlier.includes(other(link, item.dir)))
    .map((link) => {
      const id = other(link, item.dir);
      return { id, key: item.keys[item.path.indexOf(id)], link };
    });
}

/** True when a card has something to open (links to pages not on its own path). */
export const canOpen = (item) => linksOf(item.id, item.dir, 'all').some((link) => !item.path.includes(other(link, item.dir)) && other(link, item.dir) !== item.id);

/**
 * @param {{focus: string, cards: 'editorial'|'all', opened: Set<string>, more: Map<string, number>, groups: Set<string>}} journey
 * `more` holds, per "+N more" key, how many extra pages of PER_CARD were asked for.
 * @returns {{out: object[][], in: object[][], cardCount: number, moreKeys: Set<string>}} columns of items: card, stub, group, more, tierhead or head
 */
export function buildJourney(journey) {
  const { focus, cards, opened, more, groups } = journey;
  const placed = new Map([[focus, 'the focus']]);
  const moreKeys = new Set();
  const sides = {};
  let cardCount = 1;
  ['out', 'in'].forEach((dir) => {
    const columns = [];
    const sep = dir === 'out' ? '>' : '<';
    let current = [{ id: focus, key: 'f', path: [focus], keys: ['f'], dir }];
    for (let step = 1; step <= MAX_STEPS && current.length > 0; step += 1) {
      const items = [];
      const next = [];
      current.forEach((parent) => {
        if (parent.key !== 'f' && !opened.has(parent.key)) return;
        const every = linksOf(parent.id, dir, 'all').filter((link) => other(link, dir) !== parent.id);
        const free = (link) => !parent.path.includes(other(link, dir));
        const editorial = every.filter((link) => (cards === 'all' || scopeKey(link) === 'editorial') && free(link));
        const grouped = cards === 'all' ? [] : GROUP_SCOPES.map((scope) => ({ scope, members: every.filter((link) => scopeKey(link) === scope) })).filter((group) => group.members.length > 0);
        if (editorial.length === 0 && grouped.length === 0) return;
        items.push({ kind: 'head', parentId: parent.id });
        // Sorts and caps one list of links; each list has its own "+N more" button
        const emit = (list, moreKey) => {
          moreKeys.add(moreKey);
          const sorted = list.slice().sort(childSorter(dir));
          const limit = PER_CARD * (1 + (more.get(moreKey) ?? 0));
          sorted.slice(0, limit).forEach((link) => {
            const id = other(link, dir);
            const key = `${parent.key}${sep}${id}`;
            // A page that links both ways with the focus is a card on both sides next to it (marked "Both ways"),
            // not a stub: the pair is the point. Further out, a page already on the canvas is a stub.
            const twoWayNeighbour = dir === 'in' && parent.key === 'f' && placed.get(id) === 'step 1 out';
            if (placed.has(id) && !twoWayNeighbour) {
              items.push({ kind: 'stub', id, key, edge: link, parentKey: parent.key, at: placed.get(id), dir });
              return;
            }
            if (!twoWayNeighbour) placed.set(id, `step ${step} ${dir}`);
            const card = { kind: 'card', id, key, edge: link, parentKey: parent.key, path: parent.path.concat(id), keys: parent.keys.concat(key), dir, last: step === MAX_STEPS };
            items.push(card);
            next.push(card);
            cardCount += 1;
          });
          if (sorted.length > limit) items.push({ kind: 'more', parentKey: parent.key, moreKey, count: sorted.length - limit });
        };
        if (dir === 'in' && parent.key === 'f') {
          // The first in-link column can be long: one heading and one cap per tier
          const byTier = new Map();
          editorial.forEach((link) => {
            const position = tierPosition(tierIdOf(pageById(link.from))) || 99;
            byTier.set(position, (byTier.get(position) ?? []).concat(link));
          });
          [...byTier.keys()].sort((a, b) => a - b).forEach((position) => {
            const list = byTier.get(position);
            items.push({ kind: 'tierhead', label: `${tierCode(tierIdOf(pageById(list[0].from)))}: ${list.length}` });
            emit(list, `in:f:t${position}`);
          });
        } else emit(editorial, `${dir}:${parent.key}`);
        grouped.forEach(({ scope, members }) => {
          const key = `${dir}:${parent.key}|${scope}`;
          items.push({ kind: 'group', scope, count: members.length, key, open: groups.has(key), parentKey: parent.key, dir });
          if (groups.has(key)) emit(members.filter(free), key);
        });
      });
      if (!items.some((item) => item.kind !== 'head')) break;
      columns.push(items);
      current = next;
    }
    sides[dir] = columns;
  });
  return { out: sides.out, in: sides.in, cardCount, moreKeys };
}

/**
 * Rows of the tree list. Each row: page, back link (muted) or listed-above (muted).
 * @returns {{kind: 'page'|'back'|'listed', id: string, key: string, level: number, edge: object|null, text?: string, both?: boolean, canOpen?: boolean, open?: boolean}[]}
 */
export function treeRows({ focus, dir, scope, treeOpen }) {
  const rows = [];
  const listed = new Set();
  const sep = dir === 'out' ? '>' : '<';
  function walk(id, key, level, edge, path) {
    listed.add(id);
    const kids = linksOf(id, dir, scope).filter((link) => other(link, dir) !== id);
    const openable = level > 0 && kids.length > 0;
    const open = level === 0 || treeOpen.has(key);
    const both = level > 0 && kids.some((link) => other(link, dir) === path[path.length - 2]);
    rows.push({ kind: 'page', id, key, level, edge, both, canOpen: openable, open });
    if (!open || (level > 0 && !openable)) return;
    kids.sort(childSorter(dir)).forEach((link) => {
      const target = other(link, dir);
      const childKey = `${key}${sep}${target}`;
      if (path.includes(target)) {
        const step = path.indexOf(target);
        const text = dir === 'out' ? `Links back to ${pageById(target).path} (step ${step})` : `Gets a link back from ${pageById(target).path} (step ${step})`;
        rows.push({ kind: 'back', id: target, key: childKey, level: level + 1, edge: link, text });
        return;
      }
      if (listed.has(target)) {
        rows.push({ kind: 'listed', id: target, key: childKey, level: level + 1, edge: link, text: `${pageById(target).path}: listed above` });
        return;
      }
      walk(target, childKey, level + 1, link, path.concat(target));
    });
  }
  walk(focus, 'f', 0, null, [focus]);
  return rows;
}

export const depthText = (id) => (depth[id] === undefined ? 'Not reachable' : String(depth[id]));
