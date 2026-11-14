import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RowContextMenu, rowMenuItems } from './row-menu';
import type { RecordAction } from './types';
import { renderWithProviders } from '@/test/render';

interface Row {
  id: string;
}

const ROW: Row = { id: 'k1' };
const archive = vi.fn();
const open = vi.fn();
const ACTIONS: RecordAction<Row>[] = [
  { id: 'archive', label: 'Archive', group: 'destructive', onSelect: archive },
  { id: 'copy', label: 'Copy keyword', group: 'copy', onSelect: vi.fn() },
  { id: 'open', label: 'Open', group: 'open', onSelect: open },
  { id: 'check', label: 'Check now', group: 'object', disabledReason: 'Checked a minute ago', onSelect: vi.fn() },
];

beforeEach(() => {
  archive.mockReset();
  open.mockReset();
  // jsdom has no Web Animations API; Base UI's popup asks for it
  Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true, writable: true });
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

describe('rowMenuItems', () => {
  it('lists the actions in menu order, destructive last, as the More menu does', () => {
    const items = rowMenuItems(ACTIONS, ROW, 'k1');
    expect(items.map((item) => item.id)).toEqual(['open', 'check', 'copy', 'archive']);
    expect(items.map((item) => item.tone)).toEqual(['default', 'default', 'default', 'destructive']);
  });

  it('does not reorder the actions it is given', () => {
    const given = [...ACTIONS];
    rowMenuItems(ACTIONS, ROW, 'k1');
    expect(ACTIONS).toEqual(given);
  });

  it('carries the reason an action is disabled, and runs an action on that one row', () => {
    const items = rowMenuItems(ACTIONS, ROW, 'k1');
    expect(items.find((item) => item.id === 'check')?.disabledReason).toBe('Checked a minute ago');
    items.find((item) => item.id === 'open')?.onSelect?.();
    expect(open).toHaveBeenCalledWith([ROW], { ids: new Set(['k1']), allMatching: false });
  });
});

describe('RowContextMenu', () => {
  const onClose = vi.fn();
  const finalFocus = (): true => true;
  beforeEach(() => onClose.mockReset());

  it('renders nothing while point is null', () => {
    const { container } = renderWithProviders(
      <>
        <p>Before</p>
        <RowContextMenu
          point={null}
          items={rowMenuItems(ACTIONS, ROW, 'k1')}
          name="Actions for k1"
          onClose={onClose}
          finalFocus={finalFocus}
        />
      </>,
    );
    // Nothing of the menu's: no anchor button, no popup (the providers' own live regions are not its)
    expect(container.querySelector('button')).toBeNull();
    expect(document.querySelector('[data-slot="row-context-anchor"]')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('puts the anchor at the point and names the menu from `name`', async () => {
    renderWithProviders(
      <RowContextMenu
        point={{ x: 120, y: 80 }}
        items={rowMenuItems(ACTIONS, ROW, 'k1')}
        name="Actions for keyword 001"
        onClose={onClose}
        finalFocus={finalFocus}
      />,
    );
    const menu = await screen.findByRole('menu', { name: 'Actions for keyword 001' });
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4);
    const anchor = document.querySelector<HTMLElement>('[data-slot="row-context-anchor"]');
    if (anchor === null) throw new Error('no anchor');
    expect(anchor).toHaveStyle({ left: '120px', top: '80px' });
    expect(anchor).toHaveClass('fixed', 'size-0');
    expect(anchor).toHaveAttribute('tabindex', '-1');
  });

  it('lists the actions in menu order, destructive last', async () => {
    renderWithProviders(
      <RowContextMenu
        point={{ x: 10, y: 10 }}
        items={rowMenuItems(ACTIONS, ROW, 'k1')}
        name="Actions for k1"
        onClose={onClose}
        finalFocus={finalFocus}
      />,
    );
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('Open'),
      expect.stringContaining('Check now'),
      expect.stringContaining('Copy keyword'),
      expect.stringContaining('Archive'),
    ]);
  });

  it('reports a close from Escape', async () => {
    const { user } = renderWithProviders(
      <RowContextMenu
        point={{ x: 10, y: 10 }}
        items={rowMenuItems(ACTIONS, ROW, 'k1')}
        name="Actions for k1"
        onClose={onClose}
        finalFocus={finalFocus}
      />,
    );
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
