import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SavedViewMenu, type SavedViewMenuProps } from './saved-view-menu';
import { useSavedView } from './use-saved-view';
import { defaultView, type SavedView } from './views-model';
import { announce } from '@/lib/a11y/announcer';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The real announcer, watched: the menu speaks through it and never through a live region of its own
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const DEFAULT = defaultView('Default');
const BRANDED: SavedView = { id: 'branded', name: 'Branded prompts', kind: 'preset', params: { branded: 'only' } };
const UNCITED: SavedView = {
  id: 'uncited',
  name: 'Uncited',
  kind: 'preset',
  params: { cited: 'no', sort: '-mention' },
};
const PRESETS: readonly SavedView[] = [DEFAULT, BRANDED, UNCITED];
const KEYS = ['branded', 'cited', 'sort', 'q'] as const;

function props(extra: Partial<SavedViewMenuProps> = {}): SavedViewMenuProps {
  return {
    views: PRESETS,
    current: DEFAULT,
    viewKeys: KEYS,
    edited: false,
    onApply: vi.fn(),
    onReset: vi.fn(),
    ...extra,
  };
}

const trigger = (name: string | RegExp = /^Saved view:/): HTMLElement => screen.getByRole('button', { name });

type User = ReturnType<typeof renderWithProviders>['user'];
async function openWithKeyboard(user: User): Promise<HTMLElement> {
  await user.tab();
  expect(trigger()).toHaveFocus();
  await user.keyboard('{Enter}');
  return screen.findByRole('menu');
}

afterEach(() => {
  vi.mocked(announce).mockClear();
});

describe('SavedViewMenu trigger', () => {
  it('shows View, the view name and no edited mark, named "Saved view: Default"', () => {
    renderWithProviders(<SavedViewMenu {...props()} />);
    const button = trigger('Saved view: Default');
    expect(button).toHaveTextContent('View');
    expect(button).toHaveTextContent('Default');
    expect(button).not.toHaveTextContent('(edited)');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('shows (edited) and names the edited state', () => {
    renderWithProviders(<SavedViewMenu {...props({ current: BRANDED, edited: true })} />);
    const button = trigger('Saved view: Branded prompts, edited');
    expect(button).toHaveTextContent('Branded prompts');
    expect(button).toHaveTextContent('(edited)');
  });

  it('truncates a long name to a bounded width and keeps it whole in the accessible name', () => {
    const long = 'Prompts that name a competitor and are not cited by any engine in the last month'.slice(0, 60);
    expect(long).toHaveLength(60);
    renderWithProviders(<SavedViewMenu {...props({ current: { ...BRANDED, name: long } })} />);
    const button = trigger(`Saved view: ${long}`);
    const name = within(button).getByText(long);
    expect(name).toHaveClass('truncate', 'max-w-48');
    expect(button).toHaveClass('max-w-full');
  });

  it('shows the full name of a clipped view in a tooltip', async () => {
    const long = 'x'.repeat(60);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120);
    try {
      const { user } = renderWithProviders(<SavedViewMenu {...props({ current: { ...BRANDED, name: long } })} />);
      await user.hover(within(trigger()).getByText(long));
      await waitFor(() => expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(long));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('renders a hostile view name as text', () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { container } = renderWithProviders(<SavedViewMenu {...props({ current: { ...BRANDED, name: hostile } })} />);
    expect(trigger(`Saved view: ${hostile}`)).toHaveTextContent(hostile);
    expect(container.querySelector('img, script')).toBeNull();
  });

  it('describes the trigger with the notice and shows it in the menu header', async () => {
    const { user } = renderWithProviders(<SavedViewMenu {...props({ notice: '1 filter no longer exists' })} />);
    expect(trigger()).toHaveAccessibleDescription('1 filter no longer exists');
    await user.click(trigger());
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('1 filter no longer exists')).toBeInTheDocument();
  });

  it('has no description and no header without a notice', async () => {
    const { user } = renderWithProviders(<SavedViewMenu {...props()} />);
    expect(trigger()).not.toHaveAttribute('aria-describedby');
    await user.click(trigger());
    const menu = await screen.findByRole('menu');
    expect(menu.querySelector('[data-slot="menu-header"]')).toBeNull();
  });
});

describe('SavedViewMenu presets', () => {
  it('opens with Enter on a Presets group of radio items, Default first, the current one checked', async () => {
    const { user } = renderWithProviders(
      <SavedViewMenu {...props({ views: [BRANDED, DEFAULT, UNCITED], current: BRANDED })} />,
    );
    const menu = await openWithKeyboard(user);
    expect(within(menu).getByText('Presets')).toBeInTheDocument();
    const radios = within(menu).getAllByRole('menuitemradio');
    expect(radios.map((radio) => radio.textContent)).toEqual(['Default', 'Branded prompts', 'Uncited']);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  });

  it('moves with the arrows, chooses with Enter, closes and returns focus to the trigger', async () => {
    const onApply = vi.fn();
    const { user } = renderWithProviders(<SavedViewMenu {...props({ onApply })} />);
    await openWithKeyboard(user);
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Default' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Branded prompts' })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(BRANDED);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('announces the applied view and its filter count once', async () => {
    const { user } = renderWithProviders(<SavedViewMenu {...props()} />);
    await openWithKeyboard(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Branded prompts' }));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('View Branded prompts applied, 1 filter', { key: 'saved-view' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await user.click(trigger());
    await user.click(await screen.findByRole('menuitemradio', { name: 'Uncited' }));
    expect(announce).toHaveBeenLastCalledWith('View Uncited applied, 2 filters', { key: 'saved-view' });
  });

  it('announces a view without filters in words', async () => {
    const { user } = renderWithProviders(<SavedViewMenu {...props({ current: BRANDED })} />);
    await user.click(trigger());
    await user.click(await screen.findByRole('menuitemradio', { name: 'Default' }));
    expect(announce).toHaveBeenCalledWith('View Default applied, no filters', { key: 'saved-view' });
  });

  it('closes with Escape without applying anything and returns focus to the trigger', async () => {
    const onApply = vi.fn();
    const { user } = renderWithProviders(<SavedViewMenu {...props({ onApply })} />);
    await openWithKeyboard(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(onApply).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('offers Reset only when edited, and it resets and does not apply', async () => {
    const onReset = vi.fn();
    const onApply = vi.fn();
    const clean = renderWithProviders(<SavedViewMenu {...props({ current: BRANDED, onReset })} />);
    await clean.user.click(trigger());
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: /^Reset to/ })).toBeNull();
    clean.unmount();

    const { user } = renderWithProviders(
      <SavedViewMenu {...props({ current: BRANDED, edited: true, onReset, onApply })} />,
    );
    await user.click(trigger());
    await user.click(await screen.findByRole('menuitem', { name: 'Reset to Branded prompts' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('announces Reset once, as the view it returns to being applied', async () => {
    const { user } = renderWithProviders(<SavedViewMenu {...props({ current: BRANDED, edited: true })} />);
    await user.click(trigger());
    await user.click(await screen.findByRole('menuitem', { name: 'Reset to Branded prompts' }));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('View Branded prompts applied, 1 filter', { key: 'saved-view' });
  });

  it('groups stored views by scope under Workspace views and Your views, after the presets', async () => {
    const shared: SavedView = {
      id: 'w1',
      name: 'Team review',
      kind: 'stored',
      scope: 'workspace',
      params: { q: 'crm' },
    };
    const mine: SavedView = { id: 'p1', name: 'My list', kind: 'stored', scope: 'personal', params: { q: 'seo' } };
    const { user } = renderWithProviders(
      <SavedViewMenu {...props({ views: [...PRESETS, mine, shared], current: mine })} />,
    );
    await user.click(trigger());
    const menu = await screen.findByRole('menu');
    // A group is named by its label; the radio group inside it has no name of its own
    const named = within(menu)
      .getAllByRole('group')
      .filter((group) => group.hasAttribute('aria-labelledby'));
    expect(
      named.map((group) => [
        group.querySelector('[id]')?.textContent,
        ...within(group)
          .getAllByRole('menuitemradio')
          .map((radio) => radio.textContent),
      ]),
    ).toEqual([
      ['Presets', 'Default', 'Branded prompts', 'Uncited'],
      ['Workspace views', 'Team review'],
      ['Your views', 'My list'],
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'My list' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Team review' })).toHaveAttribute('aria-checked', 'false');
  });

  it('omits the group of a scope that has no views', async () => {
    const { user } = renderWithProviders(<SavedViewMenu {...props()} />);
    await user.click(trigger());
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText('Workspace views')).toBeNull();
    expect(within(menu).queryByText('Your views')).toBeNull();
  });

  it('renders hostile names in the menu as text', async () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const { user } = renderWithProviders(
      <SavedViewMenu {...props({ views: [...PRESETS, { ...BRANDED, id: 'bad', name: hostile }] })} />,
    );
    await user.click(trigger());
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitemradio', { name: hostile })).toBeInTheDocument();
    expect(menu.querySelector('img')).toBeNull();
  });
});

describe('SavedViewMenu extra items', () => {
  const COMMAND = /save|rename|delete|default|share/i;
  const extra = (onSelect: () => void = vi.fn()): NonNullable<SavedViewMenuProps['extraItems']> => [
    { id: 'save-as', label: 'Save as new view', group: 'Manage', onSelect },
    { id: 'rename', label: 'Rename view', group: 'Manage', onSelect: vi.fn() },
  ];
  const namedGroups = (menu: HTMLElement): HTMLElement[] =>
    within(menu)
      .getAllByRole('group')
      .filter((group) => group.hasAttribute('aria-labelledby'));

  it('lists no Save, Rename, Delete, Default or Share item without extra items', async () => {
    const { user } = renderWithProviders(<SavedViewMenu {...props({ current: BRANDED, edited: true })} />);
    await user.click(trigger());
    await screen.findByRole('menu');
    expect(screen.queryAllByRole('menuitem', { name: COMMAND })).toHaveLength(0);
  });

  it('renders the extra items after Reset, in a group of their own', async () => {
    const { user } = renderWithProviders(
      <SavedViewMenu {...props({ current: BRANDED, edited: true, extraItems: extra() })} />,
    );
    await user.click(trigger());
    const menu = await screen.findByRole('menu');
    const groups = namedGroups(menu);
    expect(groups.map((group) => group.querySelector('[id]')?.textContent)).toEqual(['Presets', 'Manage']);
    expect(within(groups[1] as HTMLElement).getAllByRole('menuitem')).toHaveLength(2);
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual(['Reset to Branded prompts', 'Save as new view', 'Rename view']);
  });

  it('reaches an extra item with the arrow keys, runs it with Enter and closes the menu', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(<SavedViewMenu {...props({ extraItems: extra(onSelect) })} />);
    await openWithKeyboard(user);
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Default' })).toHaveFocus());
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Save as new view' })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('runs an extra item chosen with the pointer without applying a view or announcing one', async () => {
    const onSelect = vi.fn();
    const onApply = vi.fn();
    const { user } = renderWithProviders(<SavedViewMenu {...props({ onApply, extraItems: extra(onSelect) })} />);
    await user.click(trigger());
    await user.click(await screen.findByRole('menuitem', { name: 'Save as new view' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it.each([[[]], [undefined]])('renders no group of its own for %j extra items', async (items) => {
    const { user } = renderWithProviders(
      <SavedViewMenu {...props({ current: BRANDED, edited: true, extraItems: items })} />,
    );
    await user.click(trigger());
    const menu = await screen.findByRole('menu');
    expect(namedGroups(menu)).toHaveLength(1);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Reset to Branded prompts']);
  });
});

describe('SavedViewMenu without views of its own', () => {
  it('lists the current view alone when the screen offers none', async () => {
    const { user } = renderWithProviders(<SavedViewMenu {...props({ views: [] })} />);
    await user.click(trigger('Saved view: Default'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((radio) => radio.textContent),
    ).toEqual(['Default']);
    expect(screen.getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('SavedViewMenu with the URL', () => {
  function Harness(): ReactElement {
    const saved = useSavedView({ views: PRESETS, viewKeys: [...KEYS, 'inspect', 'itab', 'win', 'from', 'to'] });
    return (
      <SavedViewMenu
        views={PRESETS}
        current={saved.view}
        viewKeys={KEYS}
        edited={saved.edited}
        onApply={saved.apply}
        onReset={saved.reset}
      />
    );
  }
  const last = (updates: string[]): URLSearchParams => new URLSearchParams(updates.at(-1) ?? '');

  it('writes view and the preset params, leaves the inspector and the date window alone, and then reads as not edited', async () => {
    const updates: string[] = [];
    const { user } = renderWithProviders(<Harness />, {
      searchParams: '?q=crm&inspect=keyword:1&itab=serp&win=7d&from=2026-01-01&to=2026-01-31',
      onUrlUpdate: (event) => updates.push(event.queryString),
    });
    expect(trigger()).toHaveAccessibleName('Saved view: Default, edited');
    await user.click(trigger());
    await user.click(await screen.findByRole('menuitemradio', { name: 'Branded prompts' }));
    await waitFor(() => expect(last(updates).get('view')).toBe('branded'));
    expect(last(updates).get('branded')).toBe('only');
    expect(last(updates).has('q')).toBe(false);
    for (const [key, value] of Object.entries({
      inspect: 'keyword:1',
      itab: 'serp',
      win: '7d',
      from: '2026-01-01',
      to: '2026-01-31',
    })) {
      expect(last(updates).get(key)).toBe(value);
    }
    await waitFor(() => expect(trigger()).toHaveAccessibleName('Saved view: Branded prompts'));
  });

  it('falls back to Default for a view id that does not exist', () => {
    renderWithProviders(<Harness />, { searchParams: '?view=gone' });
    expect(trigger()).toHaveAccessibleName('Saved view: Default');
  });

  it('resets an edited view to its params', async () => {
    const updates: string[] = [];
    const { user } = renderWithProviders(<Harness />, {
      searchParams: '?view=branded&branded=only&q=crm',
      onUrlUpdate: (event) => updates.push(event.queryString),
    });
    expect(trigger()).toHaveAccessibleName('Saved view: Branded prompts, edited');
    await user.click(trigger());
    await user.click(await screen.findByRole('menuitem', { name: 'Reset to Branded prompts' }));
    await waitFor(() => expect(last(updates).has('q')).toBe(false));
    expect(last(updates).get('branded')).toBe('only');
    await waitFor(() => expect(trigger()).toHaveAccessibleName('Saved view: Branded prompts'));
  });
});

describe('SavedViewMenu accessibility', () => {
  it.each(['light', 'dark'])('has no violation with the menu closed and open in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const shared: SavedView = {
        id: 'w1',
        name: 'Team review',
        kind: 'stored',
        scope: 'workspace',
        params: { q: 'crm' },
      };
      const { user, container } = renderWithProviders(
        <SavedViewMenu
          {...props({
            views: [...PRESETS, shared],
            current: BRANDED,
            edited: true,
            notice: '1 filter no longer exists',
          })}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
      await user.click(trigger());
      const menu = await screen.findByRole('menu');
      expect(await axe(menu)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
