/**
 * Makes any stored value safe to display (spec section 6.3). A sanitized layout is never an error state:
 * unknown cards are dropped, bad widths and options fall back to the type's defaults, and limits are enforced.
 * Sanitizing changes only what is displayed; the stored document is rewritten when the person saves.
 */
import { LIMITS, SCREENS, cardType, identityOption, isEngineCode, numberType } from './catalog';
import { WIDTHS, type CardItem, type CardTypeDefinition, type LayoutDocument, type NumberItem, type ScreenKey, type Width } from './types';

export interface SanitizeResult {
  document: LayoutDocument;
  /** True when the input differed from the result, so callers can tell a repaired layout from a clean one. */
  changed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isWidth = (value: unknown): value is Width => typeof value === 'string' && (WIDTHS as ReadonlyArray<string>).includes(value);

/** Ids are plain tokens, so they are safe in attributes, selectors and URLs without escaping. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** True when a stored value is a layout document of the current schema, however damaged its contents. */
export function isLayoutDocument(value: unknown): value is Record<string, unknown> & { schema: 1 } {
  return isRecord(value) && value.schema === 1;
}

/** Keeps ids that are usable and unique; replaces the rest with `item-N`. */
function idAllocator(): (candidate: unknown) => string {
  const used = new Set<string>();
  let counter = 0;
  return (candidate) => {
    let id = typeof candidate === 'string' && ID_PATTERN.test(candidate) && !used.has(candidate) ? candidate : '';
    while (id === '') {
      counter += 1;
      const generated = `item-${counter}`;
      if (!used.has(generated)) id = generated;
    }
    used.add(id);
    return id;
  };
}

function sanitizeOptions(type: CardTypeDefinition, raw: unknown): Record<string, string> | undefined {
  const definitions = Object.entries(type.options);
  if (definitions.length === 0) return undefined;
  const given = isRecord(raw) ? raw : {};
  return Object.fromEntries(
    definitions.map(([key, option]) => {
      const value = Object.hasOwn(given, key) ? given[key] : undefined;
      const valid = typeof value === 'string' && option.values.some((v) => v.value === value);
      return [key, valid ? value : option.default];
    }),
  );
}

function sanitizeCards(raw: unknown, screen: ScreenKey): CardItem[] {
  if (!Array.isArray(raw)) return [];
  const withWidths = SCREENS[screen].zones.widths;
  const nextId = idAllocator();
  const instances = new Map<string, number>();
  const identities = new Set<string>();
  const cards: CardItem[] = [];
  for (const entry of raw) {
    if (cards.length >= LIMITS.cards) break;
    if (!isRecord(entry) || typeof entry.type !== 'string') continue;
    // A retired type is kept: it still renders for one release, it only cannot be added (spec section 6.4).
    const type = cardType(entry.type);
    if (!type || !type.screens.includes(screen)) continue;
    const count = instances.get(type.key) ?? 0;
    if (count >= type.maxInstances) continue;

    const options = sanitizeOptions(type, entry.options);
    const identityKey = identityOption(type);
    if (identityKey && options) {
      const identity = `${type.key}|${options[identityKey] ?? ''}`;
      if (identities.has(identity)) continue;
      identities.add(identity);
    }
    instances.set(type.key, count + 1);

    const card: CardItem = { id: nextId(entry.id), type: type.key };
    if (withWidths) {
      const fallback = type.widths[0];
      const width = isWidth(entry.width) && type.widths.includes(entry.width) ? entry.width : fallback;
      if (width) card.width = width;
    }
    if (options) card.options = options;
    cards.push(card);
  }
  return cards;
}

function sanitizeNumbers(raw: unknown, screen: ScreenKey): NumberItem[] {
  if (!Array.isArray(raw)) return [];
  const nextId = idAllocator();
  const seen = new Set<string>();
  const numbers: NumberItem[] = [];
  for (const entry of raw) {
    if (numbers.length >= LIMITS.numbers) break;
    if (!isRecord(entry) || typeof entry.metric !== 'string') continue;
    const type = numberType(entry.metric);
    if (!type || !type.screens.includes(screen)) continue;
    // An AI number is always for one engine; an SEO number never carries one.
    if (type.perEngine && !isEngineCode(entry.engine)) continue;
    const engine = type.perEngine && isEngineCode(entry.engine) ? entry.engine : undefined;
    const identity = `${type.metric}|${engine ?? ''}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    numbers.push(engine ? { id: nextId(entry.id), metric: type.metric, engine } : { id: nextId(entry.id), metric: type.metric });
  }
  return numbers;
}

export function sanitizeLayout(raw: unknown, screen: ScreenKey): SanitizeResult {
  const definition = SCREENS[screen];
  if (!isLayoutDocument(raw)) {
    return { document: structuredClone(definition.builtin), changed: true };
  }
  const document: LayoutDocument = { schema: 1 };
  if (definition.zones.numbers) document.numbers = sanitizeNumbers(raw.numbers, screen);
  if (definition.zones.cards) document.cards = sanitizeCards(raw.cards, screen);
  return { document, changed: JSON.stringify(canonical(raw)) !== JSON.stringify(canonical(document)) };
}

/** A layout document nests four levels at most (document, zone, item, options). Anything deeper is not one. */
const MAX_DEPTH = 6;
const TOO_DEEP = '[nested too deeply]';

/**
 * A key-order independent form, so two documents with the same content compare equal. Stored input can be
 * nested without limit, so the walk is cut off rather than allowed to exhaust the stack.
 */
function canonical(value: unknown, depth = 0): unknown {
  if (!Array.isArray(value) && !isRecord(value)) return value;
  if (depth >= MAX_DEPTH) return TOO_DEEP;
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key], depth + 1)]),
  );
}

/** What a layout shows, without the ids that only tell its items apart. */
function content(doc: LayoutDocument): unknown {
  return {
    numbers: doc.numbers?.map(({ metric, engine }) => ({ metric, engine })),
    cards: doc.cards?.map(({ type, width, options }) => ({ type, width, options })),
  };
}

/**
 * True when two documents show the same layout, whatever the key order and whatever the item ids. A card
 * that was hidden and added back gets a new id, and that alone does not make a different layout.
 */
export function sameLayout(a: LayoutDocument, b: LayoutDocument): boolean {
  return JSON.stringify(canonical(content(a))) === JSON.stringify(canonical(content(b)));
}
