import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CardTools } from './card-toolbar';
import { LayoutGrid } from './layout-grid';
import { LayoutProvider, useLayoutScreen } from './layout-provider';
import { defineCards } from './registry';
import { announce } from '@/lib/a11y/announcer';
import type * as Announcer from '@/lib/a11y/announcer';
import { SCREENS, type CardItem, type LayoutDocument, type ScreenKey } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/** The real announcer, watched: the live region still gets every message, and a double announcement can be counted. */
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const original = await importOriginal<typeof Announcer>();
  return { ...original, announce: vi.fn(original.announce) };
});

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const BUILTIN_CARDS = SCREENS.overview.builtin.cards ?? [];
const INSPECTOR_CARDS = SCREENS['inspector.keyword'].builtin.cards ?? [];

function serve(screenKey: ScreenKey, document: LayoutDocument | null = null): void {
  server.use(
    http.get(mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/${screenKey}`), () =>
      HttpResponse.json(
        {
          data: {
            screen: screenKey,
            source: document === null ? 'builtin' : 'personal',
            document,
            team_default_exists: false,
            team_document: null,
            updated_at: document === null ? null : '2026-11-10T09:12:44Z',
            updated_by:
              document === null ? null : { user_id: '0000005a-7c1e-4a52-9b3d-00000000005a', name: 'Mara Voss' },
          },
        },
        { headers: { etag: '"e1"' } },
      ),
    ),
  );
}

function Enter(): ReactElement {
  const { actions, canCustomize } = useLayoutScreen();
  return (
    <button type="button" disabled={!canCustomize} onClick={actions.enter}>
      Customize
    </button>
  );
}

/** A real provider and grid on the mock API, in customize mode. No card has code: bodies say "not available yet". */
async function customize(
  screenKey: ScreenKey = 'overview',
  { onAddCard, document = null }: { onAddCard?: (index: number) => void; document?: LayoutDocument | null } = {},
): Promise<ProvidedRender> {
  serve(screenKey, document);
  const view = renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider
        screen={screenKey}
        workspaceId={WORKSPACE}
        capabilities={{ channels: ['seo', 'ai'], permissions: [], integrations: [] }}
        registry={defineCards({})}
      >
        <Enter />
        <LayoutGrid
          label="Cards"
          columns={screenKey === 'overview' ? 'grid' : 'one'}
          {...(onAddCard === undefined ? {} : { onAddCard })}
        />
      </LayoutProvider>
    </PermissionProvider>,
  );
  const enter = screen.getByRole('button', { name: 'Customize' });
  await waitFor(() => {
    expect(enter).toBeEnabled();
  });
  await view.user.click(enter);
  await waitFor(() => {
    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
  });
  return view;
}

const frameOf = (id: string): HTMLElement => {
  const frame = document.querySelector<HTMLElement>(`[data-layout-card="${id}"]`);
  if (frame === null) throw new Error(`no frame for ${id}`);
  return frame;
};
const ids = (): (string | undefined)[] =>
  [...document.querySelectorAll<HTMLElement>('[data-layout-card]')].map((frame) => frame.dataset.layoutCard);
const texts = (elements: readonly HTMLElement[]): (string | null)[] => elements.map((element) => element.textContent);
const polite = (): string => document.getElementById('live-region-polite')?.textContent ?? '';
/** Every sentence sent to the announcer since the test began, but the one of entering customize mode. */
const said = (): string[] =>
  vi
    .mocked(announce)
    .mock.calls.map(([message]) => message)
    .filter((message) => !message.startsWith('Customizing'));
const toolbarOf = (id: string): HTMLElement => within(frameOf(id)).getByRole('group');
/** What CardTools renders: the controls of the group after the drag handle (T9's). */
const controlsOf = (id: string): Element[] =>
  [...toolbarOf(id).querySelectorAll('button, [role="combobox"]')].filter(
    (control) => control.getAttribute('data-part') !== 'handle',
  );

beforeEach(() => {
  vi.mocked(announce).mockClear();
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

describe('the toolbar of a card', () => {
  it('is a group named after the card, with the controls named after it', async () => {
    await customize();
    const group = screen.getByRole('group', { name: 'Rank distribution card' });
    expect(within(group).getByRole('combobox', { name: 'Width of Rank distribution' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Hide Rank distribution' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Move Rank distribution' })).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: /^Options for/ })).not.toBeInTheDocument();
  });

  it('offers Options only for a card type that has options', async () => {
    await customize();
    expect(
      within(toolbarOf('key-changes')).getByRole('button', { name: 'Options for Key changes' }),
    ).toBeInTheDocument();
    expect(within(toolbarOf('trend')).queryByRole('button', { name: /^Options for/ })).not.toBeInTheDocument();
  });

  it('puts the controls in the order Width, Options, Hide, More after the handle', async () => {
    await customize();
    const controls = controlsOf('key-changes');
    expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual([
      'Width of Key changes',
      'Options for Key changes',
      'Hide Key changes',
      'Move Key changes',
    ]);
    expect(controls.map((control) => control.getAttribute('data-part'))).toEqual(['width', 'options', null, 'more']);
  });

  it('has no Width on a screen without widths', async () => {
    await customize('inspector.keyword');
    expect(ids()).toEqual(INSPECTOR_CARDS.map((card) => card.id));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(toolbarOf('key-numbers')).getByRole('button', { name: 'Hide Key numbers' })).toBeInTheDocument();
    expect(within(toolbarOf('key-numbers')).getByRole('button', { name: 'Move Key numbers' })).toBeInTheDocument();
  });

  /** CardTools alone on a screen, for an item the screen's layout does not hold. */
  const toolsOn = (screenKey: ScreenKey, item: CardItem): ProvidedRender => {
    serve(screenKey);
    return renderWithProviders(
      <PermissionProvider membership={membershipFactory('admin')}>
        <LayoutProvider
          screen={screenKey}
          workspaceId={WORKSPACE}
          capabilities={{ channels: ['seo'], permissions: [], integrations: [] }}
          registry={defineCards({})}
        >
          <CardTools item={item} />
        </LayoutProvider>
      </PermissionProvider>,
    );
  };

  it('has no Width for a card with widths on a screen that has none (the zone decides, not the card)', () => {
    const view = toolsOn('inspector.keyword', { id: 'wide', type: 'seo.rank_distribution', width: 'third' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide Rank distribution' })).toBeInTheDocument();
    view.unmount();
  });

  it('has only Hide and More for a type the catalog does not know', () => {
    const view = toolsOn('overview', { id: 'odd', type: 'no.such.card' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Options for/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide no.such.card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move no.such.card' })).toBeInTheDocument();
    view.unmount();
  });

  it('gives every control the small size, and the touch size on a coarse pointer', async () => {
    await customize();
    const [width, ...buttons] = controlsOf('key-changes');
    expect(width).toHaveAttribute('role', 'combobox');
    expect(width).toHaveClass('h-control-sm', 'pointer-coarse:h-control-touch');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toHaveClass('size-control-sm', 'pointer-coarse:size-control-touch');
    }
  });

  it('has no accessibility violations on a customizing grid', async () => {
    const view = await customize('overview', { onAddCard: () => undefined });
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe('Width', () => {
  it('offers exactly the widths of the type, by name, and shows the current one', async () => {
    const view = await customize();
    const select = within(toolbarOf('trend')).getByRole('combobox', { name: 'Width of Visibility and mention rate' });
    expect(select).toHaveTextContent('Two thirds');
    await view.user.click(select);
    const list = await screen.findByRole('listbox');
    expect(texts(within(list).getAllByRole('option'))).toEqual(['Two thirds', 'Full']);
  });

  it('applies a choice at once: the span changes, it is announced once, and focus stays on the select', async () => {
    const view = await customize();
    const select = within(toolbarOf('trend')).getByRole('combobox');
    expect(frameOf('trend')).toHaveClass('xl:col-span-8');
    await view.user.click(select);
    await view.user.click(await screen.findByRole('option', { name: 'Full' }));
    await waitFor(() => {
      expect(polite()).toBe('Visibility and mention rate width: Full');
    });
    // The provider says it; the toolbar adds nothing
    expect(said()).toEqual(['Visibility and mention rate width: Full']);
    expect(frameOf('trend')).toHaveClass('col-span-12');
    expect(frameOf('trend')).not.toHaveClass('xl:col-span-8');
    await waitFor(() => {
      expect(select).toHaveFocus();
    });
    expect(within(toolbarOf('trend')).getByRole('combobox')).toHaveTextContent('Full');
  });

  it('offers the widths of another type: Rank distribution has Third and Half', async () => {
    const view = await customize();
    await view.user.click(within(toolbarOf('rank-distribution')).getByRole('combobox'));
    const list = await screen.findByRole('listbox');
    expect(texts(within(list).getAllByRole('option'))).toEqual(['One third', 'Half']);
  });
});

describe('Hide', () => {
  it('is named Hide with the card, and its tooltip is the longer sentence', async () => {
    const view = await customize();
    const hide = within(toolbarOf('rank-distribution')).getByRole('button', { name: 'Hide Rank distribution' });
    expect(hide).toHaveAccessibleDescription('Hide card. Add it back from the catalog');
    await view.user.hover(hide);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
        'Hide card. Add it back from the catalog',
      );
    });
    expect(hide).toHaveAttribute('aria-label', 'Hide Rank distribution');
  });

  it('hides the card, says so, and moves focus to the next card', async () => {
    const view = await customize();
    await view.user.click(
      within(toolbarOf('rank-distribution')).getByRole('button', { name: 'Hide Rank distribution' }),
    );
    expect(ids()).toEqual(BUILTIN_CARDS.map((card) => card.id).filter((id) => id !== 'rank-distribution'));
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution hidden. Add it back from the catalog.');
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(frameOf('matrix').querySelector('[data-part="handle"]'));
    });
  });

  it('moves focus to the previous card when the last one goes', async () => {
    const view = await customize();
    await view.user.click(within(toolbarOf('competitors')).getByRole('button', { name: 'Hide Competitors' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(frameOf('ai-by-engine').querySelector('[data-part="handle"]'));
    });
  });

  it('moves focus to the Add card slot when the only card goes', async () => {
    const view = await customize('overview', {
      onAddCard: () => undefined,
      document: { schema: 1, numbers: [], cards: [{ id: 'solo', type: 'seo.rank_distribution', width: 'third' }] },
    });
    await view.user.click(within(toolbarOf('solo')).getByRole('button', { name: 'Hide Rank distribution' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(document.querySelector('[data-add-card-slot]'));
    });
  });
});

describe('More', () => {
  const openMenu = async (view: ProvidedRender, id: string, card: string): Promise<HTMLElement> => {
    await view.user.click(within(toolbarOf(id)).getByRole('button', { name: `Move ${card}` }));
    return screen.findByRole('menu', { name: `Move ${card}` });
  };

  it('lists the four moves, each reachable', async () => {
    const view = await customize();
    const menu = await openMenu(view, 'matrix', 'SEO and AI matrix');
    expect(texts(within(menu).getAllByRole('menuitem'))).toEqual([
      'Move earlier',
      'Move later',
      'Move to start',
      'Move to end',
    ]);
    for (const item of within(menu).getAllByRole('menuitem')) expect(item).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the moves that are impossible on the first card, disabled, with the reason', async () => {
    const view = await customize();
    const menu = await openMenu(view, 'trend', 'Visibility and mention rate');
    const item = (name: string): HTMLElement => within(menu).getByRole('menuitem', { name });
    for (const name of ['Move earlier', 'Move to start']) {
      expect(item(name)).toHaveAttribute('aria-disabled', 'true');
      expect(item(name)).toHaveAccessibleDescription('Already first');
    }
    for (const name of ['Move later', 'Move to end']) {
      expect(item(name)).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('keeps the moves that are impossible on the last card, disabled, with the reason', async () => {
    const view = await customize();
    const menu = await openMenu(view, 'competitors', 'Competitors');
    for (const name of ['Move later', 'Move to end']) {
      const item = within(menu).getByRole('menuitem', { name });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveAccessibleDescription('Already last');
    }
    expect(within(menu).getByRole('menuitem', { name: 'Move earlier' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('moves a card to the end, says where it is, and returns focus to its More button', async () => {
    const view = await customize();
    const menu = await openMenu(view, 'rank-distribution', 'Rank distribution');
    await view.user.click(within(menu).getByRole('menuitem', { name: 'Move to end' }));
    await waitFor(() => {
      expect(polite()).toBe('Rank distribution, position 8 of 8');
    });
    expect(ids().at(-1)).toBe('rank-distribution');
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(toolbarOf('rank-distribution')).getByRole('button', { name: 'Move Rank distribution' }),
      );
    });
  });

  it('moves a card earlier, later, to the start and to the end', async () => {
    const view = await customize();
    const move = async (command: string): Promise<void> => {
      const menu = await openMenu(view, 'matrix', 'SEO and AI matrix');
      await view.user.click(within(menu).getByRole('menuitem', { name: command }));
    };
    const original = BUILTIN_CARDS.map((card) => card.id);
    const without = original.filter((id) => id !== 'matrix');
    const matrixAt = (index: number): string[] => [...without.slice(0, index), 'matrix', ...without.slice(index)];

    await move('Move earlier');
    await waitFor(() => {
      expect(ids()).toEqual(matrixAt(1));
    });
    await move('Move later');
    await waitFor(() => {
      expect(ids()).toEqual(matrixAt(2));
    });
    await move('Move to start');
    await waitFor(() => {
      expect(ids()).toEqual(matrixAt(0));
    });
    await waitFor(() => {
      expect(polite()).toBe('SEO and AI matrix, position 1 of 8');
    });
    await move('Move to end');
    await waitFor(() => {
      expect(ids()).toEqual(matrixAt(7));
    });
    await waitFor(() => {
      expect(polite()).toBe('SEO and AI matrix, position 8 of 8');
    });
  });

  it('leaves the order alone when a disabled move is chosen', async () => {
    const view = await customize();
    const menu = await openMenu(view, 'trend', 'Visibility and mention rate');
    await view.user.click(within(menu).getByRole('menuitem', { name: 'Move to start' }));
    expect(ids()).toEqual(BUILTIN_CARDS.map((card) => card.id));
  });
});

describe('CardTools in a one card document', () => {
  it('disables every move with the reason of its side', async () => {
    const view = await customize('overview', {
      document: { schema: 1, numbers: [], cards: [{ id: 'solo', type: 'seo.rank_distribution', width: 'third' }] },
    });
    await view.user.click(within(toolbarOf('solo')).getByRole('button', { name: 'Move Rank distribution' }));
    const menu = await screen.findByRole('menu');
    const reasons = within(menu)
      .getAllByRole('menuitem')
      .map((item) => [item.textContent, item.getAttribute('aria-disabled')]);
    expect(reasons).toEqual([
      ['Move earlierAlready first', 'true'],
      ['Move laterAlready last', 'true'],
      ['Move to startAlready first', 'true'],
      ['Move to endAlready last', 'true'],
    ]);
  });
});
