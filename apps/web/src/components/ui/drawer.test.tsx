import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Drawer } from './drawer';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function Navigation(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open navigation
      </button>
      <Drawer open={open} onOpenChange={setOpen} title="Navigation" id="nav-drawer">
        <nav aria-label="Primary">
          <a href="/overview" onClick={() => setOpen(false)}>
            Overview
          </a>
          <a href="/keywords">Keywords</a>
        </nav>
      </Drawer>
    </>
  );
}
const open = async (user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button', { name: 'Open navigation' }));
  return screen.findByRole('dialog', { name: 'Navigation' });
};

describe('Drawer', () => {
  it('is a modal panel named by a title that is not shown', async () => {
    const { user } = renderWithProviders(<Navigation />);
    const drawer = await open(user);
    expect(within(drawer).getByText('Navigation')).toHaveClass('sr-only');
    expect(within(drawer).getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull();
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const { user } = renderWithProviders(<Navigation />);
    await open(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus());
  });

  it('closes on a click on the scrim', async () => {
    const { user, baseElement } = renderWithProviders(<Navigation />);
    await open(user);
    await user.click(baseElement.querySelector('[data-slot="drawer-scrim"]') as Element);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes when the caller says so, as after choosing a destination', async () => {
    const { user } = renderWithProviders(<Navigation />);
    const drawer = await open(user);
    within(drawer)
      .getByRole('link', { name: 'Overview' })
      .addEventListener('click', (event) => event.preventDefault());
    await user.click(within(drawer).getByRole('link', { name: 'Overview' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('comes from the left, at most 280 px wide and always leaving 56 px of the page visible', async () => {
    const { user } = renderWithProviders(<Navigation />);
    const drawer = await open(user);
    expect(drawer).toHaveClass('h-full', 'bg-surface', 'border-r', 'data-starting-style:[transform:translateX(-100%)]');
    // The swipe offset and the slide use the same property, so they cannot add up
    expect(drawer.className).toContain('[transform:translateX(var(--drawer-swipe-movement-x,0px))]');
    expect(drawer.className).not.toContain('translate-x-');
    expect(drawer.className).toContain('w-[min(17.5rem,calc(100vw-3.5rem))]');
    expect(drawer.parentElement).toHaveClass('fixed', 'inset-0', 'z-(--z-drawer)');
    expect(drawer).toHaveAttribute('id', 'nav-drawer');
  });

  it('lets a popup opened inside it come out above it', async () => {
    const { user, baseElement } = renderWithProviders(<Navigation />);
    await open(user);
    expect(baseElement.querySelector('[data-slot="drawer"]')?.closest('[data-base-ui-portal]')).toHaveClass(
      '[--z-dropdown:var(--z-drawer)]',
    );
  });

  it('has no accessibility violations while open', async () => {
    const { user, baseElement } = renderWithProviders(<Navigation />);
    await open(user);
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
