/**
 * What the card catalog lists (docs/superpowers/plans/2026-11-13-ai-wp-16-layouts-customize.md, T2): the card types
 * of one screen, in groups, each with the state its button shows. Pure, so the rules are tested without a dialog.
 */
import {
  CARD_TYPES,
  canAddCard,
  isNewCardType,
  type Availability,
  type CardGroup,
  type CardItem,
  type CardTypeDefinition,
  type LayoutDocument,
  type ScreenKey,
} from '@/lib/layouts';

/** The order the catalog shows its groups in. */
export const GROUP_ORDER: readonly CardGroup[] = ['seo', 'ai', 'cross', 'activity'];

/**
 * What the button of an entry is: `add` and `addAnother` act; `added` (the type takes no more instances),
 * `unavailable` (this project cannot use it, `reason` says why) and `pageFull` (twelve cards) do not.
 */
export type CatalogState = 'add' | 'addAnother' | 'added' | 'unavailable' | 'pageFull';

export interface CatalogEntry {
  type: CardTypeDefinition;
  state: CatalogState;
  /** Why the type is unavailable; only with that state. */
  reason?: string;
  /** Released within the last 30 days. */
  isNew: boolean;
}

export interface CatalogGroup {
  group: CardGroup;
  entries: CatalogEntry[];
}

export interface CatalogQuery {
  screen: ScreenKey;
  /** The draft: what is on the page decides Added, Add another and Page is full. */
  document: LayoutDocument;
  /** The provider's, which reads the type of the item only. */
  availabilityOf: (item: CardItem) => Availability;
  /** The search field's text. Matches title and description, ignoring case and outer spaces. */
  query: string;
  /** ISO business date of today, for "New". */
  today: string;
  /** Defaults to the catalog; a test passes its own. */
  types?: readonly CardTypeDefinition[];
}

function stateOf(
  type: CardTypeDefinition,
  { screen, document }: Pick<CatalogQuery, 'screen' | 'document'>,
  availability: Availability,
): Pick<CatalogEntry, 'state' | 'reason'> {
  if (availability.state === 'unavailable') return { state: 'unavailable', reason: availability.reason };
  const placed = (document.cards ?? []).filter((card) => card.type === type.key).length;
  if (placed >= type.maxInstances) return { state: 'added' };
  // The type and the screen fit, so what is left to refuse an add is the limit of cards on a page
  if (!canAddCard(document, type.key, screen)) return { state: 'pageFull' };
  return { state: placed > 0 ? 'addAnother' : 'add' };
}

/** The groups of the catalog for this screen and search, without the empty ones. Hidden types are never listed. */
export function catalogEntries(request: CatalogQuery): CatalogGroup[] {
  const { screen, availabilityOf, today, types = CARD_TYPES } = request;
  const query = request.query.trim().toLowerCase();
  const listed = types.flatMap((type): CatalogEntry[] => {
    if (type.status !== 'active' || !type.screens.includes(screen)) return [];
    if (query !== '' && !`${type.title} ${type.description}`.toLowerCase().includes(query)) return [];
    // The provider's function reads the type only, so a bare item stands for "this type"
    const availability = availabilityOf({ id: '', type: type.key });
    if (availability.state === 'hidden') return [];
    return [{ type, ...stateOf(type, request, availability), isNew: isNewCardType(type, today) }];
  });
  return GROUP_ORDER.map((group) => ({ group, entries: listed.filter((entry) => entry.type.group === group) })).filter(
    (group) => group.entries.length > 0,
  );
}
