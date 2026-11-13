import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { col } from './columns';
import {
  DataTableList,
  DataTableListSort,
  ListTableSwitch,
  LIST_MEDIA,
  LIST_ROW_HEIGHT,
  TOUCH_MEDIA,
  useListMode,
  type DataTableListProps,
  type ListLine1,
  type ListLine2,
} from './data-table-list';
import type { DataTableColumn, ServerPaging } from './types';
import { HOSTILE_TITLES, MARKER } from '@/components/app/cells/xss-fixtures';
import * as announcer from '@/lib/a11y/announcer';
import type { SortKey } from '@/lib/tables/table-state';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

interface Prompt {
  id: string;
  text: string;
  topic: string;
  engines: number;
  rate: number | null;
  change: number | null;
}

const ROWS: readonly Prompt[] = [
  { id: 'p1', text: 'alpha crm', topic: 'Technical SEO', engines: 3, rate: 42, change: 2 },
  { id: 'p2', text: 'beta pricing', topic: 'Pricing', engines: 2, rate: 10, change: null },
  { id: 'p3', text: 'gamma tools', topic: 'Tools', engines: 1, rate: null, change: null },
  { id: 'p4', text: 'delta stack', topic: 'Stacks', engines: 3, rate: 77, change: 1 },
  { id: 'p5', text: 'epsilon', topic: 'Misc', engines: 2, rate: 5, change: 1 },
  { id: 'p6', text: 'zeta', topic: 'Misc', engines: 1, rate: 61, change: 3 },
];

const COLUMNS = [
  col.keyword<Prompt>('prompt', (row) => row.text, { header: 'Prompt' }),
  col.count<Prompt>('mention', (row) => row.rate, { header: 'Mention rate' }),
  col.count<Prompt>('engines', (row) => row.engines, { header: 'Engines', sortable: false }),
];

const rowId = (row: Prompt): string => row.id;
const textOf = (row: Prompt): string => row.text;

const line1 = (row: Prompt): ListLine1 => ({
  identity: row.text,
  valueLabel: 'Mention rate',
  value: row.rate === null ? <span>n/a</span> : <span>{`${String(row.rate)}%`}</span>,
});
const line2 = (row: Prompt): ListLine2 => ({
  context: `${row.topic}, ${String(row.engines)} engines`,
  delta: row.change === null ? null : <span>{`improved ${String(row.change)} points`}</span>,
});

const manyRows = (count: number): Prompt[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${String(index)}`,
    text: `prompt ${String(index)}`,
    topic: 'Topic',
    engines: 2,
    rate: index,
    change: null,
  }));

const NO_SORT: readonly SortKey[] = [];

function props(extra: Partial<DataTableListProps<Prompt>> = {}): DataTableListProps<Prompt> {
  return {
    caption: 'Prompts',
    itemNoun: { one: 'prompt', other: 'prompts' },
    columns: COLUMNS,
    rows: ROWS,
    total: null,
    getRowId: rowId,
    sort: NO_SORT,
    search: '',
    searchText: textOf,
    line1,
    line2,
    onRowOpen: vi.fn(),
    status: 'ready',
    errorState: <p>Could not load</p>,
    emptyState: <p>No prompts yet</p>,
    filteredEmptyState: <p>No prompt matches</p>,
    ...extra,
  };
}

const rowButtons = (): HTMLElement[] => within(screen.getByRole('list')).getAllByRole('button');
const shownTexts = (): string[] => rowButtons().map((button) => button.textContent ?? '');

describe('DataTableList rows', () => {
  it('is one named list of two-line rows, one button each', () => {
    renderWithProviders(<DataTableList {...props()} />);
    const list = screen.getByRole('list', { name: 'Prompts, 6 results' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    items.forEach((item, index) => {
      expect(item).toHaveAttribute('aria-setsize', '6');
      expect(item).toHaveAttribute('aria-posinset', String(index + 1));
      expect(within(item).getAllByRole('button')).toHaveLength(1);
    });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('names a row by identity, value label, value, context and delta, in that order', () => {
    renderWithProviders(<DataTableList {...props()} />);
    expect(rowButtons()[0]).toHaveAccessibleName(
      'alpha crm Mention rate 42% Technical SEO, 3 engines improved 2 points',
    );
  });

  it('renders no delta node and no zero for a row without a change or a value', () => {
    renderWithProviders(<DataTableList {...props()} />);
    const [, noDelta, unknown] = rowButtons();
    expect(noDelta?.querySelector('[data-slot="list-delta"]')).toBeNull();
    expect(unknown).toHaveAccessibleName('gamma tools Mention rate n/a Tools, 1 engines');
    expect(unknown).not.toHaveTextContent('0');
  });

  it('keeps each row at 56 px or more, one line of text per line, with the full value reachable', () => {
    renderWithProviders(<DataTableList {...props()} />);
    expect(LIST_ROW_HEIGHT).toBe(56);
    const button = rowButtons()[0];
    expect(button).toHaveClass('h-full', 'w-full', 'text-left', 'px-3', 'py-2');
    expect(within(button as HTMLElement).getByText('alpha crm')).toHaveClass('min-w-0', 'truncate', 'type-body-strong');
    expect(within(button as HTMLElement).getByText('Technical SEO, 3 engines')).toHaveClass(
      'min-w-0',
      'truncate',
      'type-meta',
    );
    // The value and the delta keep their width, so rows line up and the text gives way
    expect(within(button as HTMLElement).getByText('42%').parentElement).toHaveClass('shrink-0', 'num');
    expect(screen.getByRole('list').closest('[data-slot="data-table-list-region"]')).toHaveClass(
      'overflow-y-auto',
      'overflow-x-hidden',
    );
  });

  // The window assumes every row is LIST_ROW_HEIGHT. jsdom has no layout, so this checks the classes: the real
  // pixel height must be measured in a browser (the `li` offsetHeight equals LIST_ROW_HEIGHT).
  it('gives a loaded row, a skeleton row and a focused extra row one height, the divider inside it', () => {
    const rowClass = `h-${String(LIST_ROW_HEIGHT / 4)}`;
    const ready = renderWithProviders(<DataTableList {...props()} />);
    const loaded = screen.getAllByRole('listitem')[0];
    expect(loaded).toHaveClass(rowClass, 'after:h-px', 'after:bottom-0');
    // A border on the `li` would sit outside the height and make the row 1 px taller than the window assumes
    expect(loaded).not.toHaveClass('border-b');
    expect(rowButtons()[0]).not.toHaveClass('border-b', 'min-h-14');
    ready.unmount();
    const { container } = renderWithProviders(<DataTableList {...props({ status: 'loading', rows: [] })} />);
    const skeleton = container.querySelector('[role="status"] > div');
    expect(skeleton).toHaveClass(rowClass, 'after:h-px', 'after:bottom-0');
    expect(skeleton).not.toHaveClass('border-b');
  });

  it('draws a focus ring inside the row and hover on the row', () => {
    renderWithProviders(<DataTableList {...props()} />);
    expect(rowButtons()[0]).toHaveClass('focus-visible:focus-ring-inset', 'hover:bg-surface-hover');
  });

  it('renders hostile text as text', () => {
    const hostile = HOSTILE_TITLES.map((text, index) => ({
      id: `h${String(index)}`,
      text,
      topic: text,
      engines: 1,
      rate: 1,
      change: null,
    }));
    const { container } = renderWithProviders(<DataTableList {...props({ rows: hostile })} />);
    const buttons = rowButtons();
    expect(buttons).toHaveLength(HOSTILE_TITLES.length);
    HOSTILE_TITLES.forEach((text, index) => {
      expect(buttons[index]).toHaveTextContent(text);
    });
    expect(container.querySelector('img, script, a, iframe')).toBeNull();
    expect(Reflect.get(window, MARKER)).toBeUndefined();
  });
});

describe('DataTableList order', () => {
  it('follows the sort, with an unknown value last in both directions', () => {
    const view = renderWithProviders(<DataTableList {...props({ sort: [{ id: 'mention', desc: true }] })} />);
    expect(shownTexts().map((text) => text.split(' ')[0])).toEqual([
      'delta',
      'zeta',
      'alpha',
      'beta',
      'epsilon',
      'gamma',
    ]);
    view.rerender(<DataTableList {...props({ sort: [{ id: 'mention', desc: false }] })} />);
    expect(shownTexts().map((text) => text.split(' ')[0])).toEqual([
      'epsilon',
      'beta',
      'alpha',
      'zeta',
      'delta',
      'gamma',
    ]);
  });

  it('sorts by the first key only', () => {
    renderWithProviders(
      <DataTableList
        {...props({
          sort: [
            { id: 'mention', desc: true },
            { id: 'prompt', desc: false },
          ],
        })}
      />,
    );
    expect(shownTexts()[0]).toMatch(/^delta stack/);
  });

  it('searches the way the table does and shows the filtered empty state when nothing matches', () => {
    const view = renderWithProviders(
      <DataTableList {...props({ search: '  ETA ', sort: [{ id: 'mention', desc: true }] })} />,
    );
    expect(screen.getByRole('list', { name: 'Prompts, 2 results' })).toBeInTheDocument();
    expect(shownTexts().map((text) => text.split(' ')[0])).toEqual(['zeta', 'beta']);
    view.rerender(<DataTableList {...props({ search: 'zzz' })} />);
    expect(screen.getByText('No prompt matches')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('reports the ids in the order shown, again after a sort change', () => {
    const onRowOrderChange = vi.fn();
    const view = renderWithProviders(
      <DataTableList {...props({ onRowOrderChange, sort: [{ id: 'mention', desc: true }] })} />,
    );
    expect(onRowOrderChange).toHaveBeenLastCalledWith(['p4', 'p6', 'p1', 'p2', 'p5', 'p3']);
    view.rerender(<DataTableList {...props({ onRowOrderChange, sort: [{ id: 'mention', desc: false }] })} />);
    expect(onRowOrderChange).toHaveBeenLastCalledWith(['p5', 'p2', 'p1', 'p6', 'p4', 'p3']);
    const calls = onRowOrderChange.mock.calls.length;
    view.rerender(
      <DataTableList {...props({ onRowOrderChange, rows: [...ROWS], sort: [{ id: 'mention', desc: false }] })} />,
    );
    expect(onRowOrderChange).toHaveBeenCalledTimes(calls);
  });

  it('keeps the order it is given in server mode', () => {
    const server: ServerPaging = {
      rangeText: 'Showing 201 to 206 of 412 prompts',
      offset: 200,
      hasPrevious: true,
      hasNext: false,
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      pageSize: 100,
      onPageSizeChange: vi.fn(),
    };
    renderWithProviders(<DataTableList {...props({ server, total: 412, sort: [{ id: 'mention', desc: true }] })} />);
    expect(shownTexts()[0]).toMatch(/^alpha crm/);
    const first = screen.getAllByRole('listitem')[0];
    expect(first).toHaveAttribute('aria-posinset', '201');
    expect(first).toHaveAttribute('aria-setsize', '412');
    expect(screen.getByRole('list', { name: 'Prompts, 412 results' })).toBeInTheDocument();
  });
});

describe('DataTableList opening', () => {
  it('opens a row on click, Enter and Space', async () => {
    const onRowOpen = vi.fn();
    const { user } = renderWithProviders(<DataTableList {...props({ onRowOpen })} />);
    await user.click(rowButtons()[1] as HTMLElement);
    expect(onRowOpen).toHaveBeenLastCalledWith(ROWS[1]);
    rowButtons()[2]?.focus();
    await user.keyboard('{Enter}');
    expect(onRowOpen).toHaveBeenLastCalledWith(ROWS[2]);
    await user.keyboard(' ');
    expect(onRowOpen).toHaveBeenLastCalledWith(ROWS[2]);
    expect(onRowOpen).toHaveBeenCalledTimes(3);
  });

  it('marks the active row, and only that row', () => {
    renderWithProviders(<DataTableList {...props({ activeRowId: 'p2' })} />);
    const buttons = rowButtons();
    buttons.forEach((button, index) => {
      if (index === 1) {
        expect(button).toHaveAttribute('aria-current', 'true');
        expect(button).toHaveClass('bg-surface-selected');
        expect(within(button).getByText('beta pricing')).toHaveClass('text-primary-text');
      } else {
        expect(button).not.toHaveAttribute('aria-current');
        expect(button).not.toHaveClass('bg-surface-selected');
      }
    });
  });

  it('makes every row a tab stop after the toolbar', async () => {
    const { user } = renderWithProviders(
      <DataTableList {...props({ toolbar: <button type="button">Toolbar action</button> })} />,
    );
    screen.getByRole('button', { name: 'Toolbar action' }).focus();
    await user.tab();
    expect(rowButtons()[0]).toHaveFocus();
    await user.tab();
    expect(rowButtons()[1]).toHaveFocus();
    await user.tab({ shift: true });
    expect(rowButtons()[0]).toHaveFocus();
  });
});

describe('DataTableList states', () => {
  it('shows row shaped skeletons in a named status while loading, with no spinner and no count', () => {
    const { container } = renderWithProviders(
      <DataTableList {...props({ status: 'loading', rows: [], total: null })} />,
    );
    const status = screen.getByRole('status', { name: 'Loading prompts' });
    expect(status.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(16);
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/0 prompts/)).toBeNull();
  });

  it('renders the error, empty and filtered-empty slots', () => {
    const view = renderWithProviders(<DataTableList {...props({ status: 'error', rows: [] })} />);
    expect(screen.getByText('Could not load')).toBeInTheDocument();
    expect(screen.queryByText(/prompts$/)).toBeNull();
    view.rerender(<DataTableList {...props({ status: 'empty', rows: [] })} />);
    expect(screen.getByText('No prompts yet')).toBeInTheDocument();
    view.rerender(<DataTableList {...props({ status: 'filtered-empty', rows: [] })} />);
    expect(screen.getByText('No prompt matches')).toBeInTheDocument();
  });

  it('keeps the rows while refetching, marks the list busy and draws the refetch bar', () => {
    const view = renderWithProviders(<DataTableList {...props({ status: 'refetching' })} />);
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
    expect(rowButtons()).toHaveLength(6);
    expect(view.container.querySelector('[data-slot="list-refetch-bar"]')).not.toBeNull();
    view.rerender(<DataTableList {...props()} />);
    expect(view.container.querySelector('[data-slot="list-refetch-bar"]')).toBeNull();
    expect(screen.getByRole('list')).not.toHaveAttribute('aria-busy');
  });

  it('says Updating once a refetch has run for 400 ms', () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<DataTableList {...props({ status: 'refetching' })} />);
      expect(screen.queryByText('Updating')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.getByText('Updating')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says how much has loaded while the rest loads', () => {
    renderWithProviders(<DataTableList {...props({ loadProgress: { loaded: 3, total: 6 } })} />);
    expect(screen.getByText('Loading 3 of 6 prompts')).toBeInTheDocument();
  });

  it('puts the freshness note after the count', () => {
    renderWithProviders(<DataTableList {...props({ footerNote: 'Updated 12m ago' })} />);
    expect(screen.getByText(/6 prompts.*Updated 12m ago/)).toBeInTheDocument();
  });

  it('pages in server mode with the range text and Previous and Next', async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const server: ServerPaging = {
      rangeText: 'Showing 1 to 6 of 412 prompts',
      offset: 0,
      hasPrevious: false,
      hasNext: true,
      onPrevious,
      onNext,
      pageSize: 100,
      onPageSizeChange: vi.fn(),
    };
    const { user } = renderWithProviders(<DataTableList {...props({ server, total: 412 })} />);
    expect(screen.getByText('Showing 1 to 6 of 412 prompts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onNext).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPrevious).not.toHaveBeenCalled();
  });
});

describe('DataTableList windowing', () => {
  it('renders only the rows near the view, with aria-hidden spacers, and keeps the active row', () => {
    const rows = manyRows(150);
    const { container } = renderWithProviders(<DataTableList {...props({ rows, activeRowId: 'p140' })} />);
    const items = container.querySelectorAll('li[aria-setsize]');
    expect(items.length).toBeLessThan(150);
    const spacers = container.querySelectorAll<HTMLElement>('li[aria-hidden="true"]');
    expect(spacers.length).toBeGreaterThan(0);
    spacers.forEach((spacer) => expect(spacer.style.height).not.toBe(''));
    expect(screen.getByRole('button', { name: /prompt 140 / })).toHaveAttribute('aria-current', 'true');
    // The positions stay those of the whole list
    expect(screen.getByRole('button', { name: /prompt 140 / }).closest('li')).toHaveAttribute('aria-posinset', '141');
    expect(screen.getByRole('list', { name: 'Prompts, 150 results' })).toBeInTheDocument();
  });

  const region = (container: HTMLElement): HTMLElement => {
    const element = container.querySelector<HTMLElement>('[data-slot="data-table-list-region"]');
    if (element === null) throw new Error('The scrolling region is not rendered');
    return element;
  };
  const scrollTo = (element: HTMLElement, scrollTop: number): void => {
    fireEvent.scroll(element, { target: { scrollTop } });
  };
  /** Spacers plus rendered rows, in pixels: what the scroll height is made of. */
  const contentHeight = (container: HTMLElement): number => {
    const spacers = [...container.querySelectorAll<HTMLElement>('li[aria-hidden="true"]')];
    const rendered = container.querySelectorAll('li[aria-setsize]').length;
    return (
      spacers.reduce((sum, spacer) => sum + Number.parseFloat(spacer.style.height), 0) + rendered * LIST_ROW_HEIGHT
    );
  };

  it('keeps the scroll height at every row times LIST_ROW_HEIGHT, and renders other rows after a scroll', () => {
    const { container } = renderWithProviders(<DataTableList {...props({ rows: manyRows(150) })} />);
    expect(contentHeight(container)).toBe(150 * LIST_ROW_HEIGHT);
    expect(rowButtons()[0]).toHaveTextContent(/^prompt 0 /);
    scrollTo(region(container), 5000);
    expect(contentHeight(container)).toBe(150 * LIST_ROW_HEIGHT);
    expect(rowButtons()[0]).not.toHaveTextContent(/^prompt 0 /);
    expect(screen.queryByRole('button', { name: /prompt 0 / })).toBeNull();
    expect(screen.getByRole('button', { name: /prompt 90 / })).toBeInTheDocument();
  });

  it('keeps the focused row in the document, and focused, when the window moves away from it', () => {
    const { container } = renderWithProviders(<DataTableList {...props({ rows: manyRows(150) })} />);
    const first = screen.getByRole('button', { name: /prompt 0 / });
    act(() => first.focus());
    scrollTo(region(container), 5000);
    expect(screen.getByRole('button', { name: /prompt 0 / })).toBe(first);
    expect(first).toHaveFocus();
    expect(first.closest('li')).toHaveAttribute('aria-posinset', '1');
    expect(contentHeight(container)).toBe(150 * LIST_ROW_HEIGHT);
  });

  describe('a server page', () => {
    const page = (offset: number): ServerPaging => ({
      rangeText: `Showing ${String(offset + 1)} to ${String(offset + 150)} of 412 prompts`,
      offset,
      hasPrevious: offset > 0,
      hasNext: true,
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      pageSize: 150,
      onPageSizeChange: vi.fn(),
    });

    it('starts again at its first row when the offset changes', () => {
      const rows = manyRows(150);
      const view = renderWithProviders(<DataTableList {...props({ rows, server: page(0), total: 412 })} />);
      scrollTo(region(view.container), 5000);
      expect(screen.queryByRole('button', { name: /prompt 0 / })).toBeNull();
      expect(region(view.container).scrollTop).toBe(5000);
      view.rerender(<DataTableList {...props({ rows, server: page(150), total: 412 })} />);
      expect(region(view.container).scrollTop).toBe(0);
      expect(screen.getByRole('button', { name: /prompt 0 / })).toBeInTheDocument();
    });

    it('ignores the search text, since the rows come searched', () => {
      renderWithProviders(<DataTableList {...props({ server: page(0), total: 412, search: 'zeta' })} />);
      expect(rowButtons()).toHaveLength(ROWS.length);
      expect(screen.getByRole('list', { name: 'Prompts, 412 results' })).toBeInTheDocument();
    });
  });
});

describe('DataTableList result count announcement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is silent on the first render and speaks once when the count changes', () => {
    const announce = vi.spyOn(announcer, 'announce');
    const view = renderWithProviders(<DataTableList {...props()} />);
    expect(announce).not.toHaveBeenCalled();
    view.rerender(<DataTableList {...props({ search: 'zeta' })} />);
    expect(announce).toHaveBeenCalledExactlyOnceWith('1 prompt', {
      debounceMs: 500,
      key: expect.stringMatching(/-count$/),
    });
    // The same count again is not spoken again
    view.rerender(<DataTableList {...props({ search: 'zeta', sort: [{ id: 'mention', desc: true }] })} />);
    expect(announce).toHaveBeenCalledOnce();
  });
});

describe('useListMode', () => {
  let setMedia: (next: { narrow?: boolean; touch?: boolean }) => void;
  beforeEach(() => {
    const state = { narrow: true, touch: false };
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches(): boolean {
        return query === LIST_MEDIA ? state.narrow : query === TOUCH_MEDIA ? state.touch : false;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    setMedia = (next) => {
      Object.assign(state, next);
      act(() => {
        listeners.forEach((listener) => listener());
      });
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function Probe(): ReactElement {
    const { mode, canSwitch, onModeChange } = useListMode();
    return (
      <div>
        <output aria-label="state">{`${mode} ${String(canSwitch)}`}</output>
        <button type="button" onClick={() => onModeChange('table')}>
          choose table
        </button>
        <button type="button" onClick={() => onModeChange('list')}>
          choose list
        </button>
      </div>
    );
  }
  const state = (): string => screen.getByLabelText('state').textContent ?? '';

  it('uses the two media queries of the design system', () => {
    expect(LIST_MEDIA).toBe('(width < 48rem)');
    expect(TOUCH_MEDIA).toBe('(pointer: coarse) and (hover: none)');
  });

  it('is the table at 768 px and wider, and cannot switch', () => {
    setMedia({ narrow: false });
    renderWithProviders(<Probe />);
    expect(state()).toBe('table false');
  });

  it('is the list on a touch-primary screen below 768 px and offers no switch', async () => {
    setMedia({ touch: true });
    const { user } = renderWithProviders(<Probe />);
    expect(state()).toBe('list false');
    await user.click(screen.getByRole('button', { name: 'choose table' }));
    expect(state()).toBe('list false');
  });

  it('is the list below 768 px, and a screen that is not touch-primary may switch to the table', async () => {
    const { user } = renderWithProviders(<Probe />);
    expect(state()).toBe('list true');
    await user.click(screen.getByRole('button', { name: 'choose table' }));
    expect(state()).toBe('table true');
    await user.click(screen.getByRole('button', { name: 'choose list' }));
    expect(state()).toBe('list true');
  });

  it('forgets the choice of Table when the layout class changes', async () => {
    const { user } = renderWithProviders(<Probe />);
    await user.click(screen.getByRole('button', { name: 'choose table' }));
    expect(state()).toBe('table true');
    setMedia({ narrow: false });
    expect(state()).toBe('table false');
    setMedia({ narrow: true });
    expect(state()).toBe('list true');
  });

  it('answers table on the server render, where the screen is narrow but nothing has been measured', () => {
    expect(renderToString(<Probe />)).toContain('table false');
  });
});

describe('ListTableSwitch', () => {
  it('is a radio group named Layout with List and Table', async () => {
    const onModeChange = vi.fn();
    const { user } = renderWithProviders(<ListTableSwitch mode="list" onModeChange={onModeChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Layout' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: 'List' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Table' }));
    expect(onModeChange).toHaveBeenCalledWith('table');
  });
});

describe('DataTableListSort', () => {
  const onChange = vi.fn();
  beforeEach(() => {
    onChange.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Renders the sort menu and opens it the way a keyboard does: focus the trigger, press Enter. */
  async function openSort(sort: readonly SortKey[]): Promise<UserEvent> {
    const { user } = renderWithProviders(<DataTableListSort columns={COLUMNS} sort={sort} onSortChange={onChange} />);
    screen.getByRole('button', { name: /^Sort/ }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    return user;
  }

  it('reads Sort and the column on its trigger', () => {
    renderWithProviders(
      <DataTableListSort columns={COLUMNS} sort={[{ id: 'mention', desc: true }]} onSortChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Sort: Mention rate Sort descending' })).toBeInTheDocument();
  });

  it('shows the direction on its trigger, in the arrow and in a spoken word', () => {
    const view = renderWithProviders(
      <DataTableListSort columns={COLUMNS} sort={[{ id: 'mention', desc: true }]} onSortChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Sort descending$/ }).querySelector('.lucide-arrow-down')).not.toBeNull();
    view.rerender(
      <DataTableListSort columns={COLUMNS} sort={[{ id: 'mention', desc: false }]} onSortChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Sort ascending$/ }).querySelector('.lucide-arrow-up')).not.toBeNull();
  });

  it('announces the new sort once, as the table does, when a column is chosen', async () => {
    const announce = vi.spyOn(announcer, 'announce');
    const user = await openSort([{ id: 'mention', desc: true }]);
    await user.click(screen.getByRole('menuitemradio', { name: 'Prompt' }));
    expect(announce).toHaveBeenCalledExactlyOnceWith('Sorted by Prompt descending', {
      key: expect.stringMatching(/-sort$/),
    });
  });

  it('announces the new sort once when the direction is chosen', async () => {
    const announce = vi.spyOn(announcer, 'announce');
    const user = await openSort([{ id: 'mention', desc: true }]);
    await user.click(screen.getByRole('menuitemradio', { name: 'Sort ascending' }));
    expect(announce).toHaveBeenCalledExactlyOnceWith('Sorted by Mention rate ascending', {
      key: expect.stringMatching(/-sort$/),
    });
  });

  it('gives a column chosen with no sort its own default direction: text ascending, a count descending', async () => {
    const first = await openSort([]);
    await first.click(screen.getByRole('menuitemradio', { name: 'Prompt' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'prompt', desc: false }]);
    cleanup();
    const second = await openSort([]);
    await second.click(screen.getByRole('menuitemradio', { name: 'Mention rate' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'mention', desc: true }]);
  });

  it('does not offer a column the table cannot sort, such as a sparkline', async () => {
    const sparkline: DataTableColumn<Prompt> = {
      ...col.count<Prompt>('trend', (row) => row.rate, { header: 'Trend' }),
      type: 'sparkline',
    };
    const { user } = renderWithProviders(
      <DataTableListSort columns={[...COLUMNS, sparkline]} sort={[]} onSortChange={onChange} />,
    );
    screen.getByRole('button', { name: /^Sort/ }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    expect(screen.getAllByRole('menuitemradio').map((radio) => radio.textContent)).toEqual(['Prompt', 'Mention rate']);
  });

  it('lists only the sortable columns, and the direction', async () => {
    await openSort([{ id: 'mention', desc: true }]);
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((radio) => radio.textContent)).toEqual([
      'Prompt',
      'Mention rate',
      'Sort ascending',
      'Sort descending',
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'Mention rate' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Sort descending' })).toBeChecked();
    expect(screen.getByText('Sort by')).toBeInTheDocument();
    expect(screen.getByText('Direction')).toBeInTheDocument();
  });

  it('keeps the direction when another column is chosen', async () => {
    const user = await openSort([{ id: 'mention', desc: true }]);
    await user.click(screen.getByRole('menuitemradio', { name: 'Prompt' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([{ id: 'prompt', desc: true }]);
  });

  it('changes the direction and keeps the column', async () => {
    const user = await openSort([{ id: 'mention', desc: true }]);
    await user.click(screen.getByRole('menuitemradio', { name: 'Sort ascending' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([{ id: 'mention', desc: false }]);
  });

  it('offers no direction while nothing is sorted', async () => {
    await openSort([]);
    expect(screen.getAllByRole('menuitemradio').map((radio) => radio.textContent)).toEqual(['Prompt', 'Mention rate']);
  });

  it('reads plain Sort while nothing is sorted', () => {
    renderWithProviders(<DataTableListSort columns={COLUMNS} sort={[]} onSortChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Sort' })).toBeInTheDocument();
  });
});

describe('DataTableList accessibility', () => {
  function Full(): ReactElement {
    const [sort, setSort] = useState<readonly SortKey[]>([{ id: 'mention', desc: true }]);
    return (
      <DataTableList
        {...props({
          sort,
          activeRowId: 'p2',
          toolbar: (
            <>
              <DataTableListSort columns={COLUMNS} sort={sort} onSortChange={setSort} />
              <ListTableSwitch mode="list" onModeChange={vi.fn()} />
            </>
          ),
        })}
      />
    );
  }

  it.each(['light', 'dark'])('has no violation with the toolbar in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const { container } = renderWithProviders(<Full />);
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });

  it('has no violation while loading', async () => {
    const { container } = renderWithProviders(<DataTableList {...props({ status: 'loading', rows: [] })} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
