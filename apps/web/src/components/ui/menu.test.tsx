import { screen, waitFor, within } from '@testing-library/react';
import { Archive, Copy, Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { Menu, type MenuItemDef } from './menu';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const items = (handlers: Partial<Record<string, () => void>> = {}): MenuItemDef[] => [
  { id: 'delete', label: 'Delete', icon: Trash2, tone: 'destructive', onSelect: handlers.delete },
  { id: 'open', label: 'Open', group: 'Keyword', onSelect: handlers.open },
  { id: 'copy', label: 'Copy link', icon: Copy, shortcut: ['mod', 'c'], group: 'Keyword', onSelect: handlers.copy },
  { id: 'check', label: 'Check now', disabledReason: '20 of 20 used today', onSelect: handlers.check },
  { id: 'archive', label: 'Archive', icon: Archive, onSelect: handlers.archive },
];
const open = async (user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> => {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.findByRole('menu');
};

describe('Menu', () => {
  it('opens from its trigger, which says it has a menu and whether it is open', async () => {
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items()} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const menu = await open(user);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(5);
  });

  it('runs the command of the item that is chosen and closes', async () => {
    const archive = vi.fn();
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items({ archive })} />);
    const menu = await open(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('works from the keyboard: Down opens on the first item, arrows move, Enter activates, Escape returns focus', async () => {
    const copy = vi.fn();
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items({ copy })} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Open' })).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');
    expect(copy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await user.click(trigger);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('lists destructive items last, after a separator, whatever position they were given', async () => {
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items()} />);
    const menu = await open(user);
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(labels[labels.length - 1]).toBe('Delete');
    const destructive = within(menu).getByRole('menuitem', { name: 'Delete' });
    expect(destructive).toHaveClass('text-negative-text', 'data-highlighted:bg-negative-subtle');
    expect(within(menu).getAllByRole('separator').length).toBeGreaterThan(0);
  });

  it('lists items under the name of their group', async () => {
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items()} />);
    const menu = await open(user);
    const group = within(menu).getByRole('group', { name: 'Keyword' });
    const inGroup = within(group).getAllByRole('menuitem');
    expect(inGroup).toHaveLength(2);
    expect(inGroup[0]).toHaveAccessibleName('Open');
    // The key caps are decoration here: the item declares the shortcut itself
    expect(inGroup[1]).toHaveAccessibleName('Copy link');
  });

  it('shows a shortcut as key caps and exposes it on the item', async () => {
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items()} />);
    const menu = await open(user);
    const item = within(menu).getByRole('menuitem', { name: /Copy link/ });
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Control+c');
    expect([...item.querySelectorAll('kbd')].map((cap) => cap.textContent)).toEqual(['Ctrl', 'C']);
  });

  it('keeps a disabled item in the list with its reason, and does not run it', async () => {
    const check = vi.fn();
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items({ check })} />);
    const menu = await open(user);
    const item = within(menu).getByRole('menuitem', { name: /Check now/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('20 of 20 used today');
    await user.click(item);
    expect(check).not.toHaveBeenCalled();
  });

  it('shows checkbox items with their state and keeps the menu in step with the caller', async () => {
    const toggle = vi.fn();
    const { user } = renderWithProviders(
      <Menu
        trigger={<Button>More actions</Button>}
        items={[
          { id: 'intervals', label: 'Show intervals', kind: 'checkbox', checked: true, onSelect: toggle },
          { id: 'annotations', label: 'Show annotations', kind: 'checkbox', checked: false },
        ]}
      />,
    );
    const menu = await open(user);
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Show intervals' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Show intervals' }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('shows a run of radio items as one choice', async () => {
    const dark = vi.fn();
    const { user } = renderWithProviders(
      <Menu
        trigger={<Button>More actions</Button>}
        items={[
          { id: 'light', label: 'Light', kind: 'radio', checked: true, group: 'Theme' },
          { id: 'dark', label: 'Dark', kind: 'radio', group: 'Theme', onSelect: dark },
        ]}
      />,
    );
    const menu = await open(user);
    expect(within(menu).getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }));
    expect(dark).toHaveBeenCalledTimes(1);
  });

  it('renders a link item as a link, and closes when it is followed', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <Menu
        trigger={<Button>More actions</Button>}
        items={[{ id: 'settings', label: 'Account settings', kind: 'link', link: <a href="#account" />, onSelect }]}
      />,
    );
    const menu = await open(user);
    const link = within(menu).getByRole('menuitem', { name: 'Account settings' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '#account');
    await user.click(link);
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('lists a link that is disabled as a plain item with its reason, which goes nowhere', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <Menu
        trigger={<Button>More actions</Button>}
        items={[
          {
            id: 'billing',
            label: 'Billing',
            kind: 'link',
            link: <a href="#billing" />,
            disabledReason: 'Owners only',
            onSelect,
          },
        ]}
      />,
    );
    const menu = await open(user);
    const item = within(menu).getByRole('menuitem', { name: /Billing/ });
    expect(item.tagName).not.toBe('A');
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('Owners only');
    await user.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens a submenu with Right, runs its items, and closes it with Left', async () => {
    const tag = vi.fn();
    const { user } = renderWithProviders(
      <Menu
        trigger={<Button>More actions</Button>}
        items={[{ id: 'tag', label: 'Add tag', kind: 'submenu', items: [{ id: 'crm', label: 'crm', onSelect: tag }] }]}
      />,
    );
    const menu = await open(user);
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Add tag' })).toHaveFocus());
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menuitem', { name: 'crm' })).toBeInTheDocument();
    expect(screen.getAllByRole('menu')).toHaveLength(2);
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: 'crm' }));
    expect(tag).toHaveBeenCalledTimes(1);
  });

  it('marks the row the keyboard is on with the elevated hover fill and an inset ring', async () => {
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items()} />);
    const menu = await open(user);
    expect(within(menu).getByRole('menuitem', { name: 'Open' })).toHaveClass(
      'data-highlighted:bg-surface-elevated-hover',
      'focus-visible:focus-ring-inset',
    );
  });

  it('passes other attributes on to the popup, which stays named by its trigger', async () => {
    const { user } = renderWithProviders(
      <Menu trigger={<Button>More actions</Button>} items={items()} id="row-menu" data-row="12" />,
    );
    const menu = await open(user);
    expect(menu).toHaveAttribute('id', 'row-menu');
    expect(menu).toHaveAttribute('data-row', '12');
    expect(menu).toHaveAccessibleName('More actions');
  });

  it('is an elevated surface 180 to 280 px wide with 32 px rows', async () => {
    const { user } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items()} />);
    const menu = await open(user);
    expect(menu).toHaveClass(
      'min-w-menu-min',
      'max-w-menu-max',
      'p-1',
      'rounded-lg',
      'bg-surface-elevated',
      'shadow-popover',
    );
    expect(menu.parentElement).toHaveClass('z-(--z-dropdown)');
    expect(within(menu).getByRole('menuitem', { name: 'Open' })).toHaveClass('h-8', 'px-2', 'rounded-md', 'type-body');
  });

  it('has no accessibility violations while open', async () => {
    const { user, baseElement } = renderWithProviders(<Menu trigger={<Button>More actions</Button>} items={items()} />);
    await open(user);
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
