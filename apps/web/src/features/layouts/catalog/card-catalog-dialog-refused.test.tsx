import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CardCatalogDialog } from './card-catalog-dialog';
import { renderWithProviders } from '@/test/render';

/*
 * An add the provider refuses (the draft changed under an open catalog, so the type no longer fits). The real
 * provider cannot be made to refuse through its buttons, which are disabled for what it would refuse, so its
 * hook is replaced by one whose `addCard` answers null.
 */
const { addCard } = vi.hoisted(() => ({
  addCard: vi.fn<(type: string, index?: number) => string | null>(() => null),
}));

vi.mock('../layout-provider', () => ({
  useLayoutScreen: () => ({
    screen: 'overview',
    document: { schema: 1, cards: [] },
    availabilityOf: () => ({ state: 'available' }),
    actions: { addCard },
  }),
}));

function Host(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Opener
      </button>
      <CardCatalogDialog open={open} index={3} onOpenChange={setOpen} />
    </>
  );
}

describe('CardCatalogDialog when the provider refuses the add', () => {
  it('closes and gives focus back to the opener, since no card is there to take it', async () => {
    const { user } = renderWithProviders(<Host />);
    await user.click(screen.getByRole('button', { name: 'Opener' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add card' });
    await user.click(within(dialog).getByRole('button', { name: 'Add Top movers' }));
    expect(addCard).toHaveBeenCalledWith('seo.top_movers', 3);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add card' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus();
  });
});
