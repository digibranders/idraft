import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddCardSlot, addSlotClass } from './add-card-slot';
import { LayoutGrid, SPAN_CLASS } from './layout-grid';
import { LayoutProvider, useLayoutScreen } from './layout-provider';
import { defineCards } from './registry';
import type { CardItem, LayoutDocument, Width } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const THIRD = SPAN_CLASS.third;
const HALF = SPAN_CLASS.half;

const card = (id: string, width: Width): CardItem => ({ id, type: 'seo.rank_distribution', width });

describe('addSlotClass', () => {
  it('takes the third that is free after the last row at the wide breakpoint', () => {
    expect(addSlotClass([card('a', 'half'), card('b', 'half'), card('c', 'two_thirds')])).toBe(THIRD);
    expect(addSlotClass([card('a', 'third'), card('b', 'third')])).toBe(THIRD);
    expect(addSlotClass([card('a', 'two_thirds')])).toBe(THIRD);
  });

  it('takes half a row when the last row is full, there is no card, or more than a third is free', () => {
    expect(addSlotClass([card('a', 'half'), card('b', 'half')])).toBe(HALF);
    expect(addSlotClass([card('a', 'full')])).toBe(HALF);
    expect(addSlotClass([card('a', 'half')])).toBe(HALF);
    expect(addSlotClass([card('a', 'third')])).toBe(HALF);
    expect(addSlotClass([])).toBe(HALF);
  });
});

describe('AddCardSlot', () => {
  it('is a dashed button named Add card, with the catalog hint as its description', () => {
    renderWithProviders(<AddCardSlot index={3} onAdd={() => undefined} cards={[]} />);
    const slot = screen.getByRole('button', { name: 'Add card' });
    expect(slot).toHaveAttribute('data-add-card-slot');
    expect(slot).toHaveAccessibleDescription('Opens the card catalog');
    expect(slot).toHaveClass('border-dashed', 'border-border-strong', 'rounded-lg', 'min-h-30', HALF);
  });

  it('is the width of the space the last row leaves', () => {
    renderWithProviders(
      <AddCardSlot index={2} onAdd={() => undefined} cards={[card('a', 'third'), card('b', 'third')]} />,
    );
    expect(screen.getByRole('button', { name: 'Add card' })).toHaveClass(THIRD);
  });

  it('calls onAdd with the index it was given, once per click', async () => {
    const onAdd = vi.fn();
    const { user } = renderWithProviders(<AddCardSlot index={5} onAdd={onAdd} cards={[]} />);
    await user.click(screen.getByRole('button', { name: 'Add card' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('can be reached and used from the keyboard', async () => {
    const onAdd = vi.fn();
    const { user } = renderWithProviders(<AddCardSlot index={1} onAdd={onAdd} cards={[]} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add card' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('has no accessibility violations', async () => {
    const view = renderWithProviders(<AddCardSlot index={0} onAdd={() => undefined} cards={[]} />);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

/** Twelve cards (the limit) of twelve types, and one of them fewer. */
const TWELVE: CardItem[] = [
  { id: 'c01', type: 'trend.visibility_mentions', width: 'full' },
  { id: 'c02', type: 'seo.rank_distribution', width: 'half' },
  { id: 'c03', type: 'seo.top_movers', width: 'half' },
  { id: 'c04', type: 'seo.serp_features', width: 'half' },
  { id: 'c05', type: 'ai.by_engine', width: 'half' },
  { id: 'c06', type: 'ai.mention_trend', width: 'half', options: { engine: 'chatgpt_web' } },
  { id: 'c07', type: 'ai.citation_share_by_domain_type', width: 'half' },
  { id: 'c08', type: 'cross.matrix_summary', width: 'half' },
  { id: 'c09', type: 'cross.unclassified', width: 'half' },
  { id: 'c10', type: 'cross.opportunities', width: 'half' },
  { id: 'c11', type: 'competitors.summary', width: 'half' },
  { id: 'c12', type: 'activity.key_changes', width: 'half' },
];

async function customizeWith(cards: CardItem[], onAddCard: (index: number) => void): Promise<ProvidedRender> {
  const layout: LayoutDocument = { schema: 1, numbers: [], cards };
  server.use(
    http.get(mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/overview`), () =>
      HttpResponse.json(
        {
          data: {
            screen: 'overview',
            source: 'personal',
            document: layout,
            team_default_exists: false,
            team_document: null,
            updated_at: '2026-11-10T09:12:44Z',
            updated_by: { user_id: '0000005a-7c1e-4a52-9b3d-00000000005a', name: 'Mara Voss' },
          },
        },
        { headers: { etag: '"e1"' } },
      ),
    ),
  );
  const view = renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider
        screen="overview"
        workspaceId={WORKSPACE}
        capabilities={{ channels: ['seo', 'ai'], permissions: [], integrations: [] }}
        registry={defineCards({})}
      >
        <Enter />
        <LayoutGrid label="Overview cards" onAddCard={onAddCard} />
      </LayoutProvider>
    </PermissionProvider>,
  );
  const enter = screen.getByRole('button', { name: 'Customize' });
  await waitFor(() => {
    expect(enter).toBeEnabled();
  });
  await view.user.click(enter);
  await waitFor(() => {
    // In customize mode a card shows its controls (a group); with no card there is only the slot
    expect(document.querySelector('[role="group"], [data-add-card-slot]')).not.toBeNull();
  });
  return view;
}

function Enter(): ReactElement {
  const { actions, canCustomize } = useLayoutScreen();
  return (
    <button type="button" disabled={!canCustomize} onClick={actions.enter}>
      Customize
    </button>
  );
}

describe('the Add card slot in the customize grid', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is after the last card while there are fewer than 12, and calls onAdd with the end of the list', async () => {
    const onAdd = vi.fn();
    const view = await customizeWith(TWELVE.slice(0, 11), onAdd);
    await view.user.click(screen.getByRole('button', { name: 'Add card' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(11);
    const slot = document.querySelector('[data-add-card-slot]');
    const frames = document.querySelectorAll('[data-layout-card]');
    // After the last card in document order (the grid may put its own hidden nodes in between)
    if (slot === null) throw new Error('no Add card slot');
    expect(frames[frames.length - 1]?.compareDocumentPosition(slot)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('is not there at 12 cards, the limit', async () => {
    await customizeWith(TWELVE, () => undefined);
    expect(document.querySelectorAll('[data-layout-card]')).toHaveLength(12);
    expect(document.querySelector('[data-add-card-slot]')).toBeNull();
  });

  it('shows the sentence for an empty page, and the slot', async () => {
    const onAdd = vi.fn();
    const view = await customizeWith([], onAdd);
    expect(screen.getByText('This page has no cards. Add one from the catalog.')).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Add card' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith(0);
  });
});
