import type { CardItem } from '@/lib/layouts';

/**
 * Partitions cards in view mode: ready cards first, not-ready (empty) cards last.
 * Preserves the relative order of cards within each partition.
 */
export function adaptCardsByReadiness(
  cards: readonly CardItem[],
  isNotReady: (id: string) => boolean,
): readonly CardItem[] {
  if (cards.length === 0) return cards;
  const ready: CardItem[] = [];
  const notReady: CardItem[] = [];
  for (const card of cards) {
    if (isNotReady(card.id)) {
      notReady.push(card);
    } else {
      ready.push(card);
    }
  }
  if (notReady.length === 0 || ready.length === 0) return cards;
  return [...ready, ...notReady];
}
