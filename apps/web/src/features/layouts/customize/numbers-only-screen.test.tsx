import { screen, waitFor, within } from '@testing-library/react';
import { EllipsisVertical } from 'lucide-react';
import { useRef, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NumberStrip, type NumberValue } from '../numbers/number-strip';
import { defineCards } from '../registry';
import { CustomizableScreen } from './customizable-screen';
import { useCustomizeMenuItem } from './customize-button';
import { CustomizingBadge } from './customizing-badge';
import { PageHeader } from '@/components/app/shell/page-header';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import type { NumberItem } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { BOTH_CHANNELS, serveLayouts, stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  serveLayouts();
  stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const valueOf = (item: NumberItem): NumberValue => ({ value: `value ${item.id}`, context: `context ${item.id}` });

/**
 * A table page as T10 composes it: the title is hidden (the breadcrumb shows it), the More menu has the Customize
 * numbers item, the strip is the only customizable part, and the badge sits with the actions. No grid.
 */
function TableHeader(): ReactElement {
  const more = useRef<HTMLButtonElement>(null);
  const customize = useCustomizeMenuItem('customizeNumbers', more);
  return (
    <>
      <PageHeader
        title="Overview"
        titleHidden
        actions={
          <>
            <CustomizingBadge />
            <Menu
              align="end"
              items={customize === null ? [] : [customize]}
              trigger={<IconButton ref={more} icon={EllipsisVertical} label="More actions" />}
            />
          </>
        }
      />
      <NumberStrip label="Overview numbers" valueOf={valueOf} status="ready" />
    </>
  );
}

function Page(): ReactElement {
  return (
    <PermissionProvider membership={membershipFactory('admin')}>
      <CustomizableScreen
        screen="overview"
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceName="Acme"
        capabilities={BOTH_CHANNELS}
        registry={defineCards({})}
      >
        <TableHeader />
      </CustomizableScreen>
    </PermissionProvider>
  );
}

type User = ReturnType<typeof renderWithProviders>['user'];

async function startCustomizing(user: User): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  const item = await screen.findByRole('menuitem', { name: 'Customize numbers' });
  await waitFor(() => {
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
  });
  await user.click(item);
  await screen.findByRole('group', { name: 'No changes' });
}

describe('a table page that customizes its numbers', () => {
  it('shows no controls and no badge until the item is chosen', () => {
    renderWithProviders(<Page />);
    expect(screen.queryByRole('button', { name: /^Reorder / })).toBeNull();
    expect(screen.queryByRole('group', { name: 'No changes' })).toBeNull();
    expect(screen.queryByText('Customizing')).toBeNull();
  });

  it('enters a numbers only screen from the Customize numbers item, and the strip shows its controls', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    const strip = screen.getByRole('group', { name: 'Overview numbers' });
    expect(within(strip).getAllByRole('button', { name: /^Reorder / }).length).toBeGreaterThan(0);
    expect(within(strip).getAllByRole('button', { name: /^Remove / }).length).toBeGreaterThan(0);
    expect(screen.getByText('Customizing')).toBeInTheDocument();
  });

  it('has no grid and no Add card', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    expect(screen.queryByRole('region', { name: /cards/i })).toBeNull();
    expect(document.querySelector('[data-add-card-slot]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add card/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Hide / })).toBeNull();
  });

  it('returns focus to the More button when the mode ends', async () => {
    const { user } = renderWithProviders(<Page />);
    await startCustomizing(user);
    await user.click(within(screen.getByRole('group', { name: 'No changes' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'No changes' })).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus();
    });
  });
});
