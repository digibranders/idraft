import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineCards } from '../registry';
import { DrawerCustomizer, DrawerGrid, useDrawerCustomize } from './drawer-customizer';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import type { MenuItemDef } from '@/components/ui/menu';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { BOTH_CHANNELS, serveLayouts, stubViewport } from '@/test/customize-harness';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

/** The width beside the sidebar that the layout measures: wide enough for the inspector to dock, never a sheet. */
class AreaObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: { width: 1232, height: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

const onClose = vi.fn();

beforeEach(() => {
  onClose.mockReset();
  serveLayouts();
  stubViewport();
  vi.stubGlobal('ResizeObserver', AreaObserver);
  vi.stubGlobal('innerWidth', 1440);
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** What a drawer writes: the real Inspector with the three parts of `useDrawerCustomize`. */
function Drawer(): ReactElement {
  const drawer = useDrawerCustomize();
  const moreActions: MenuItemDef[] = drawer.menuItem === null ? [] : [drawer.menuItem];
  return (
    <InspectorLayout
      inspector={
        <Inspector
          type="keyword"
          backLabel="Back to Keywords"
          onClose={drawer.guardClose(onClose)}
          header={{
            title: 'best crm for startups',
            typeLabel: 'Keyword',
            typeNoun: 'keyword',
            moreActions,
            moreButtonRef: drawer.moreButtonRef,
          }}
          footer={drawer.saveBar}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <DrawerGrid label="Keyword cards" />
          </div>
        </Inspector>
      }
    >
      <button type="button">A row of the list</button>
    </InspectorLayout>
  );
}

function Page(): ReactElement {
  return (
    <PermissionProvider membership={membershipFactory('admin')}>
      <DrawerCustomizer
        screen="inspector.keyword"
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceName="Acme"
        capabilities={BOTH_CHANNELS}
        registry={defineCards({})}
      >
        <Drawer />
      </DrawerCustomizer>
    </PermissionProvider>
  );
}

const MORE = 'More actions for best crm for startups';
type User = ReturnType<typeof renderWithProviders>['user'];

/** The drawer's More menu, opened once the layout has loaded (its item says why it is disabled before). */
async function openMore(user: User): Promise<HTMLElement> {
  const more = screen.getByRole('button', { name: MORE });
  await user.click(more);
  const item = await screen.findByRole('menuitem', { name: 'Customize cards' });
  await waitFor(() => {
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
  });
  return item;
}

async function startCustomizing(user: User): Promise<void> {
  await user.click(await openMore(user));
  await screen.findByRole('group', { name: 'No changes' });
}

const aside = (): HTMLElement => screen.getByRole('complementary', { name: 'best crm for startups' });

async function hideFirstCard(user: User): Promise<void> {
  await user.click(within(aside()).getByRole('button', { name: 'Hide Key numbers' }));
  await screen.findByRole('group', { name: '1 change' });
}

describe('DrawerCustomizer', () => {
  it('renders the cards in one column with no width control', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    const cards = within(aside()).getByRole('region', { name: 'Keyword cards' });
    expect(within(cards).getAllByRole('button', { name: /^Hide / })).toHaveLength(4);
    expect(within(cards).queryByRole('combobox', { name: /^Width of / })).toBeNull();
    // The cells are stacked, not placed on the 12 columns of a page
    expect(cards.querySelector('.grid-cols-12')).toBeNull();
    expect(cards.querySelector('[data-layout-card].col-span-12')).toBeNull();
    expect(cards.querySelector('[data-layout-card]')?.parentElement).toHaveClass('flex-col');
  });

  it('starts the mode from the Customize cards item of the More menu', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    expect(within(aside()).getByRole('button', { name: 'Reorder Key numbers' })).toBeInTheDocument();
  });

  it('returns focus to the More button when the mode ends', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    await user.click(within(screen.getByRole('group', { name: 'No changes' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'No changes' })).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: MORE })).toHaveFocus();
    });
  });

  it('puts the save bar in the footer of the drawer, in the drawer variant', async () => {
    const { user } = renderWithProviders(<Page />);
    expect(screen.queryByRole('group', { name: 'No changes' })).toBeNull();
    await startCustomizing(user);
    const bar = within(aside()).getByRole('group', { name: 'No changes' });
    expect(bar).toHaveAttribute('data-slot', 'layout-save-bar');
    expect(bar).toHaveClass('px-4');
    expect(bar).not.toHaveClass('sticky');
  });

  it('keeps its own box out of the layout, so a docked Inspector stays sticky in its row', () => {
    renderWithProviders(<Page />);
    expect(document.querySelector('[data-customize-root]')).toHaveClass('contents');
  });

  it('runs close at once while the mode is off or clean', async () => {
    const { user } = renderWithProviders(<Page />);
    await user.click(within(aside()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await startCustomizing(user);
    await user.click(within(aside()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'No changes' })).toBeNull();
    });
  });

  it('asks before the drawer closes when there are changes, and closes it only after Discard', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    await hideFirstCard(user);
    await user.click(within(aside()).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: '1 change' })).toBeInTheDocument();
    await user.click(within(aside()).getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('group', { name: '1 change' })).toBeNull();
  });

  it('asks once when Escape is pressed in the drawer with changes, and keeps the drawer open on Keep editing', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    await hideFirstCard(user);
    // Where the inspector puts focus when it opens (a control with a tooltip would give that the first Escape)
    within(aside()).getByRole('heading', { name: 'best crm for startups' }).focus();
    await user.keyboard('{Escape}');
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    });
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: '1 change' })).toBeInTheDocument();
  });

  it('closes the drawer once after Escape and Discard', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    await hideFirstCard(user);
    within(aside()).getByRole('heading', { name: 'best crm for startups' }).focus();
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('has no axe violation in customize mode', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
