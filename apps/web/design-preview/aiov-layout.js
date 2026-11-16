/* global localStorage, structuredClone */
/**
 * The layout of the AI visibility Overview: which cards, in what order, at what width. Pure functions plus the
 * storage of a person's layout and the team default. Same shape as the layout library (src/lib/layouts): a document
 * `{ schema, cards: [{ id, type, width }] }`, at most 12 cards, resolved personal first, then team, then built in.
 * In the app this is the layouts API (core.layouts); here browser storage stands in for it, with the key convention
 * of customize.js.
 */
import { CARD_REGISTRY, cardDef } from './aiov-registry.js';

export const LIMIT = 12;
export const SCREEN = 'ai_overview';
export const COLUMNS = { third: 4, half: 6, two_thirds: 8, full: 12 };

const card = (key, width) => ({ id: key, type: key, width });
const doc = (list) => ({ schema: 1, cards: list.map(([key, width]) => card(key, width)) });

/** Presets: each fills complete rows of 12 columns at 1280 px and has at most 12 cards. */
export const PRESETS = {
  default: {
    label: 'Default',
    description: 'One card for each section of the sheet: headline, competitors, groups, citations, position, sentiment, traffic, fan-out.',
    document: doc([
      ['ai.visibility_split', 'full'],
      ['ai.rate_trend_by_engine', 'two_thirds'],
      ['ai.outcome_mix', 'third'],
      ['ai.share_of_voice', 'half'],
      ['ai.lost_to_competitor', 'half'],
      ['ai.topic_heatmap', 'full'],
      ['sources.top_domains', 'third'],
      ['ai.position_distribution', 'third'],
      ['ai.sentiment_by_engine', 'third'],
      ['traffic.ai_referrals', 'two_thirds'],
      ['ai.fanout_top', 'third'],
    ]),
  },
  executive: {
    label: 'Executive',
    description: 'The headline, the trend, who leads, where, and what changed.',
    document: doc([
      ['ai.visibility_split', 'full'],
      ['ai.rate_trend_by_engine', 'two_thirds'],
      ['ai.outcome_mix', 'third'],
      ['ai.share_of_voice', 'half'],
      ['ai.sov_over_time', 'half'],
      ['ai.topic_heatmap', 'two_thirds'],
      ['ai.topic_extremes', 'third'],
      ['sources.top_domains', 'half'],
      ['activity.key_changes', 'half'],
      ['traffic.ai_referrals', 'full'],
    ]),
  },
  analyst: {
    label: 'Analyst',
    description: 'Position, sentiment, unlinked mentions, your cited pages and collection health.',
    document: doc([
      ['ai.visibility_split', 'full'],
      ['ai.rate_trend_by_engine', 'two_thirds'],
      ['ai.outcome_mix', 'third'],
      ['ai.position_distribution', 'half'],
      ['ai.sentiment_by_engine', 'half'],
      ['ai.unlinked_mentions', 'half'],
      ['sources.own_pages', 'half'],
      ['ai.topic_heatmap', 'full'],
      ['ai.fanout_top', 'half'],
      ['activity.key_changes', 'half'],
      ['ops.answer_calendar', 'full'],
    ]),
  },
  competitive: {
    label: 'Competitive',
    description: 'Share of voice, the gap to each competitor and the sources behind it.',
    document: doc([
      ['ai.visibility_split', 'full'],
      ['ai.rate_trend_by_engine', 'two_thirds'],
      ['ai.outcome_mix', 'third'],
      ['ai.share_of_voice', 'half'],
      ['ai.sov_over_time', 'half'],
      ['ai.lost_to_competitor', 'full'],
      ['sources.top_domains', 'half'],
      ['ai.citation_share_by_domain_type', 'half'],
      ['ai.unlinked_mentions', 'half'],
      ['sources.own_pages', 'half'],
    ]),
  },
};
export const PRESET_KEYS = Object.keys(PRESETS);

// -------------------------------------------------------------------------------------------------
// Storage: never throws. When storage is blocked the layout lasts for this page only.

const memory = new Map();
const unsynced = new Set();
const storageKey = (kind) => `preview-layout:${kind}:${SCREEN}`;

export function readStored(kind) {
  const key = storageKey(kind);
  if (unsynced.has(key)) return memory.get(key) ?? null;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeStored(kind, document) {
  const key = storageKey(kind);
  if (document === null) memory.delete(key);
  else memory.set(key, document);
  try {
    if (document === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(document));
    unsynced.delete(key);
  } catch {
    unsynced.add(key);
  }
}

// -------------------------------------------------------------------------------------------------
// Sanitizing: a stored document is data. Unknown cards, repeats, widths a card cannot take and anything past the limit go.

export function sanitize(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.cards)) return null;
  const seen = new Set();
  const cards = [];
  for (const item of input.cards) {
    const def = typeof item?.type === 'string' ? cardDef(item.type) : undefined;
    if (!def || seen.has(def.key)) continue;
    seen.add(def.key);
    cards.push({ id: def.key, type: def.key, width: def.widths.includes(item.width) ? item.width : def.widths[0] });
    if (cards.length === LIMIT) break;
  }
  // A document of cards that no longer exist says nothing: the next layout in line applies, as if it were not stored
  if (cards.length === 0 && input.cards.length > 0) return null;
  return { schema: 1, cards };
}

/** The layout shown: the person's own, else the team's, else the built in Default. */
export function resolveLayout() {
  const personal = sanitize(readStored('personal'));
  if (personal) return { document: personal, source: 'personal' };
  const team = sanitize(readStored('team'));
  if (team) return { document: team, source: 'team' };
  return { document: structuredClone(PRESETS.default.document), source: 'default' };
}

/** What Reset goes back to: the team default when there is one, else the built in Default. */
export function resetTarget() {
  const team = sanitize(readStored('team'));
  return team ?? structuredClone(PRESETS.default.document);
}

// -------------------------------------------------------------------------------------------------
// Edits: each returns a new document

export const hasCard = (document, key) => document.cards.some((item) => item.type === key);

export function moveCard(document, id, to) {
  const from = document.cards.findIndex((item) => item.id === id);
  if (from < 0) return document;
  const target = Math.max(0, Math.min(document.cards.length - 1, to));
  if (from === target) return document;
  const cards = [...document.cards];
  const [item] = cards.splice(from, 1);
  cards.splice(target, 0, item);
  return { ...document, cards };
}

export const moveCardBy = (document, id, delta) => moveCard(document, id, document.cards.findIndex((item) => item.id === id) + delta);

export function setWidth(document, id, width) {
  return { ...document, cards: document.cards.map((item) => (item.id === id && cardDef(item.type).widths.includes(width) ? { ...item, width } : item)) };
}

export const hideCard = (document, id) => ({ ...document, cards: document.cards.filter((item) => item.id !== id) });

export function addCard(document, key) {
  const def = cardDef(key);
  if (!def || hasCard(document, key) || document.cards.length >= LIMIT) return document;
  return { ...document, cards: [...document.cards, card(key, def.widths[0])] };
}

export const applyPreset = (key) => structuredClone(PRESETS[key].document);

export const sameLayout = (a, b) => a.cards.length === b.cards.length && a.cards.every((item, index) => item.id === b.cards[index].id && item.width === b.cards[index].width);

/** Cards in the catalog that the layout does not show, in catalog order. */
export const hiddenCards = (document) => CARD_REGISTRY.filter((def) => !hasCard(document, def.key));

/**
 * How many edits separate two layouts: cards added, cards removed, cards whose width changed, and cards that moved
 * relative to the ones both layouts keep.
 */
export function changeCount(saved, draft) {
  const before = new Map(saved.cards.map((item) => [item.id, item]));
  const after = new Map(draft.cards.map((item) => [item.id, item]));
  let count = 0;
  for (const id of after.keys()) if (!before.has(id)) count += 1;
  for (const id of before.keys()) if (!after.has(id)) count += 1;
  const kept = saved.cards.map((item) => item.id).filter((id) => after.has(id));
  const keptNow = draft.cards.map((item) => item.id).filter((id) => before.has(id));
  // Moving one card past three others is one move, not four: the moved ones are those outside the longest common run
  count += kept.length - commonLength(kept, keptNow);
  for (const id of kept) if (after.get(id).width !== before.get(id).width) count += 1;
  return count;
}

/** Length of the longest common subsequence of two lists of ids. */
function commonLength(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
  }
  return table[a.length][b.length];
}

/** Whether every row of the layout fills 12 columns at 1280 px, for the presets' own check. */
export function rowsFull(document) {
  let used = 0;
  for (const item of document.cards) {
    const columns = COLUMNS[item.width];
    if (used + columns > 12) return false;
    used = (used + columns) % 12;
  }
  return used === 0;
}
