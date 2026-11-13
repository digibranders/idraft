import type { ReactElement } from 'react';

import type { ExportBlock } from '@/features/ai-overview/export/export-model';
import { useExportBlock } from '@/features/ai-overview/export/export-registry';
import { defineCards, type CardProps, type CardRegistration } from '@/features/layouts';
import { CARD_TYPES } from '@/lib/layouts';

/*
 * A stand-in for the cards of the AI visibility Overview, for the tests of the page's own parts (the Export menu,
 * the shortcuts). A test file turns it on with
 *   vi.mock('../cards/registry', async () => (await import('@/test/fake-overview-cards')).fakeRegistryModule());
 * so no chart or table of a card package is drawn, and sets `fakeCards.block` to say what each card tells the
 * export: nothing (the default), a table, a table still loading (`null`), or a table that cannot be built.
 */

export type FakeBlock = (itemId: string) => ExportBlock | null;

export const fakeCards: { block: FakeBlock | null } = { block: null };

function Registering({ id, block }: { id: string; block: FakeBlock }): null {
  useExportBlock(id, () => block(id));
  return null;
}

function FakeCard({ item }: CardProps): ReactElement {
  const block = fakeCards.block;
  return (
    <div data-testid={`fake-card-${item.id}`} className="type-body">
      {block === null ? null : <Registering id={item.id} block={block} />}
      {item.id}
    </div>
  );
}

/** The module `cards/registry` is replaced by: a fake card for every active card type of the screen. */
export function fakeRegistryModule(): { AI_OVERVIEW_CARDS: ReturnType<typeof defineCards> } {
  const entries: Record<string, CardRegistration> = {};
  for (const type of CARD_TYPES) {
    if (type.status === 'active' && type.screens.includes('ai_overview')) {
      entries[type.key] = { load: () => Promise.resolve({ default: FakeCard }) };
    }
  }
  return { AI_OVERVIEW_CARDS: defineCards(entries) };
}
