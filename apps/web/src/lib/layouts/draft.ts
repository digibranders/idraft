/**
 * Edits made in customize mode (spec section 5). Each function returns a new document, or the same document
 * when the edit is not allowed, so callers can tell "nothing happened" by identity. Ids are supplied by the
 * caller, which keeps these functions pure.
 */
import { LIMITS, cardType, defaultOptions, identityOption, isEngineCode, numberType } from './catalog';
import { sameLayout } from './sanitize';
import type { CardItem, CardTypeDefinition, EngineCode, LayoutDocument, NumberItem, ScreenKey, Width } from './types';

const cardsOf = (doc: LayoutDocument): CardItem[] => doc.cards ?? [];
const numbersOf = (doc: LayoutDocument): NumberItem[] => doc.numbers ?? [];

/** An index that is missing or not a number means "at the end". */
function insertAt<T>(items: ReadonlyArray<T>, item: T, index: number | undefined): T[] {
  const at = index === undefined || Number.isNaN(index) ? items.length : Math.min(Math.max(Math.trunc(index), 0), items.length);
  return [...items.slice(0, at), item, ...items.slice(at)];
}

function moveTo<T extends { id: string }>(items: ReadonlyArray<T>, id: string, toIndex: number): T[] | null {
  const from = items.findIndex((item) => item.id === id);
  const item = items[from];
  if (!item || Number.isNaN(toIndex)) return null;
  const to = Math.min(Math.max(Math.trunc(toIndex), 0), items.length - 1);
  if (to === from) return null;
  const without = items.filter((other) => other.id !== id);
  return [...without.slice(0, to), item, ...without.slice(to)];
}

function instanceCount(doc: LayoutDocument, typeKey: string): number {
  return cardsOf(doc).filter((card) => card.type === typeKey).length;
}

function canPlace(doc: LayoutDocument, type: CardTypeDefinition | undefined): type is CardTypeDefinition {
  return type !== undefined && type.status === 'active' && cardsOf(doc).length < LIMITS.cards && instanceCount(doc, type.key) < type.maxInstances;
}

/** Whether the catalog may offer this card type for this screen right now. */
export function canAddCard(doc: LayoutDocument, typeKey: string, screen: ScreenKey): boolean {
  const type = cardType(typeKey);
  return canPlace(doc, type) && type.screens.includes(screen);
}

/**
 * The identity values (see identityOption) that other instances of a reusable type already use. The options
 * editor disables these, and setCardOption refuses them, so two instances never show the same thing.
 */
export function takenIdentityValues(doc: LayoutDocument, type: CardTypeDefinition, exceptId?: string): Set<string> {
  const key = identityOption(type);
  const taken = new Set<string>();
  if (!key) return taken;
  for (const card of cardsOf(doc)) {
    const value = card.options?.[key];
    if (card.type === type.key && card.id !== exceptId && value !== undefined) taken.add(value);
  }
  return taken;
}

/** Options for a new instance. A reusable type starts on the first identity value no other instance uses. */
function optionsForNewInstance(doc: LayoutDocument, type: CardTypeDefinition): Record<string, string> | undefined {
  const options = defaultOptions(type);
  const key = identityOption(type);
  if (!options || !key) return options;
  const taken = takenIdentityValues(doc, type);
  const free = type.options[key]?.values.find((candidate) => !taken.has(candidate.value));
  return free ? { ...options, [key]: free.value } : options;
}

export function addCard(doc: LayoutDocument, typeKey: string, id: string, index?: number): LayoutDocument {
  const type = cardType(typeKey);
  if (!canPlace(doc, type) || cardsOf(doc).some((card) => card.id === id)) return doc;
  const card: CardItem = { id, type: type.key };
  const [defaultWidth] = type.widths;
  if (defaultWidth) card.width = defaultWidth;
  const options = optionsForNewInstance(doc, type);
  if (options) card.options = options;
  return { ...doc, cards: insertAt(cardsOf(doc), card, index) };
}

export function hideCard(doc: LayoutDocument, id: string): LayoutDocument {
  const cards = cardsOf(doc);
  if (!cards.some((card) => card.id === id)) return doc;
  return { ...doc, cards: cards.filter((card) => card.id !== id) };
}

export function moveCard(doc: LayoutDocument, id: string, toIndex: number): LayoutDocument {
  const cards = moveTo(cardsOf(doc), id, toIndex);
  return cards ? { ...doc, cards } : doc;
}

export function setCardWidth(doc: LayoutDocument, id: string, width: Width): LayoutDocument {
  const card = cardsOf(doc).find((candidate) => candidate.id === id);
  if (!card || card.width === width || !cardType(card.type)?.widths.includes(width)) return doc;
  return { ...doc, cards: cardsOf(doc).map((candidate) => (candidate.id === id ? { ...candidate, width } : candidate)) };
}

export function setCardOption(doc: LayoutDocument, id: string, key: string, value: string): LayoutDocument {
  const card = cardsOf(doc).find((candidate) => candidate.id === id);
  const type = card ? cardType(card.type) : undefined;
  // Only the type's own option keys count: "constructor" and the like are not options.
  const option = type && Object.hasOwn(type.options, key) ? type.options[key] : undefined;
  if (!card || !type || !option || card.options?.[key] === value || !option.values.some((candidate) => candidate.value === value)) return doc;
  if (key === identityOption(type) && takenIdentityValues(doc, type, id).has(value)) return doc;
  return { ...doc, cards: cardsOf(doc).map((candidate) => (candidate.id === id ? { ...candidate, options: { ...candidate.options, [key]: value } } : candidate)) };
}

/** Whether a number can be added: known metric, an engine exactly when the metric is per engine, not shown yet, room left. */
export function canAddNumber(doc: LayoutDocument, metric: string, engine?: EngineCode): boolean {
  const type = numberType(metric);
  if (!type || numbersOf(doc).length >= LIMITS.numbers) return false;
  // Callers outside TypeScript can pass anything, so the engine is checked, not trusted.
  if (type.perEngine ? !isEngineCode(engine) : engine !== undefined) return false;
  return !numbersOf(doc).some((number) => number.metric === metric && number.engine === engine);
}

export function addNumber(doc: LayoutDocument, number: NumberItem, index?: number): LayoutDocument {
  if (!canAddNumber(doc, number.metric, number.engine) || numbersOf(doc).some((other) => other.id === number.id)) return doc;
  return { ...doc, numbers: insertAt(numbersOf(doc), number, index) };
}

export function removeNumber(doc: LayoutDocument, id: string): LayoutDocument {
  const numbers = numbersOf(doc);
  if (!numbers.some((number) => number.id === id)) return doc;
  return { ...doc, numbers: numbers.filter((number) => number.id !== id) };
}

export function moveNumber(doc: LayoutDocument, id: string, toIndex: number): LayoutDocument {
  const numbers = moveTo(numbersOf(doc), id, toIndex);
  return numbers ? { ...doc, numbers } : doc;
}

/**
 * Items are matched by id, then the rest by kind in order. The second pass is what makes a card that was
 * hidden and added back (with a new id) count as the same card, moved or edited, not as one hidden plus one added.
 */
function zoneChanges<T extends { id: string }>(before: ReadonlyArray<T>, after: ReadonlyArray<T>, kindOf: (item: T) => string, differs: (a: T, b: T) => number): number {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const unmatched = new Set(before);
  const previousOf = new Map<T, T>();
  for (const item of after) {
    const previous = beforeById.get(item.id);
    if (previous && unmatched.delete(previous)) previousOf.set(item, previous);
  }
  for (const item of after) {
    if (previousOf.has(item)) continue;
    const previous = [...unmatched].find((candidate) => kindOf(candidate) === kindOf(item));
    if (previous && unmatched.delete(previous)) previousOf.set(item, previous);
  }

  const added = after.length - previousOf.size;
  const removed = unmatched.size;
  let edited = 0;
  for (const [item, previous] of previousOf) edited += differs(previous, item);
  const keptBefore = before.filter((item) => !unmatched.has(item));
  const keptAfter = after.flatMap((item) => previousOf.get(item) ?? []);
  const reordered = keptBefore.some((item, index) => item !== keptAfter[index]) ? 1 : 0;
  return added + removed + edited + reordered;
}

const sameOptions = (a: CardItem, b: CardItem): boolean => {
  const keys = new Set([...Object.keys(a.options ?? {}), ...Object.keys(b.options ?? {})]);
  return [...keys].every((key) => a.options?.[key] === b.options?.[key]);
};

/**
 * The number shown in the save bar: added, hidden, resized and re-optioned items count once each, and a
 * reorder counts once per zone. It is zero exactly when the two layouts show the same thing (sameLayout):
 * the Save button, the discard question and what gets stored all rest on that.
 */
export function changeCount(before: LayoutDocument, after: LayoutDocument): number {
  if (sameLayout(before, after)) return 0;
  const cards = zoneChanges(
    cardsOf(before),
    cardsOf(after),
    (card) => card.type,
    (a, b) => Number(a.type !== b.type) + Number(a.width !== b.width) + Number(!sameOptions(a, b)),
  );
  const numbers = zoneChanges(
    numbersOf(before),
    numbersOf(after),
    (number) => `${number.metric}|${number.engine ?? ''}`,
    (a, b) => Number(a.metric !== b.metric || a.engine !== b.engine),
  );
  return Math.max(cards + numbers, 1);
}
