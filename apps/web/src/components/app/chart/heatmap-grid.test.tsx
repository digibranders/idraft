import { act, screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartFrame } from './chart-frame';
import { HeatmapGrid, type HeatCell, type HeatmapGridProps, type HeatRow } from './heatmap-grid';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The frame loads ECharts for its line and bar kinds only; the html kind never reaches it
vi.mock('./echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

const COLUMNS = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'claude', label: 'Claude' },
];

const ok = (tip: string, value: number, text: string, href?: Route): HeatCell => ({
  value,
  answers: 136,
  state: 'ok',
  text,
  tip,
  href,
});

const CRM_HREF = '/design-system/charts' as Route;
const CRM_CHATGPT = 'CRM on ChatGPT: 47%, prompt weighted over 17 prompts, 64 of 136 answers';
const CRM_GEMINI = 'CRM on Gemini: 3 answers, fewer than 4';
const CRM_CLAUDE = 'CRM on Claude: no answers';
const STARTUPS_CHATGPT = 'CRM for startups on ChatGPT: 20%, 4 of 20 answers';

const HATCHED: HeatCell = { value: 0.75, answers: 3, state: 'insufficient', text: '75%', tip: CRM_GEMINI };
const NONE: HeatCell = { value: 0, answers: 0, state: 'none', text: '0%', tip: CRM_CLAUDE };

const CHILD: HeatRow = {
  id: 'startups',
  label: 'Startups',
  name: 'Startups',
  prompts: '5',
  cells: [
    ok(STARTUPS_CHATGPT, 0.2, '20%'),
    ok('CRM for startups on Gemini: 35%, 7 of 20 answers', 0.35, '35%'),
    ok('CRM for startups on Claude: 50%, 10 of 20 answers', 0.5, '50%'),
  ],
};

const CRM: HeatRow = {
  id: 'crm',
  label: 'CRM',
  name: 'CRM',
  prompts: '17',
  cells: [ok(CRM_CHATGPT, 0.47, '47%', CRM_HREF), HATCHED, NONE],
  children: [CHILD],
};

const EMAIL: HeatRow = {
  id: 'email',
  label: 'Email',
  name: 'Email',
  prompts: '9',
  cells: [
    ok('Email on ChatGPT: 5%, 2 of 40 answers', 0.05, '5%'),
    ok('Email on Gemini: 80%, 32 of 40 answers', 0.8, '80%'),
    ok('Email on Claude: 0%, 0 of 40 answers', 0, '0%'),
  ],
};

const FLAT_ROWS: readonly HeatRow[] = [{ ...CRM, children: undefined }, EMAIL];

const BASE: HeatmapGridProps = {
  caption: 'Mention rate by topic and engine',
  rowHeader: 'Topic',
  promptsHeader: 'Prompts',
  columns: COLUMNS,
  rows: [CRM, EMAIL],
  scale: 'sequential',
  density: 'default',
};

const grid = (): HTMLElement => screen.getByRole('treegrid', { name: 'Mention rate by topic and engine' });
const cellNamed = (name: string): HTMLElement => screen.getByRole('gridcell', { name });
const tabStops = (): readonly Element[] => Array.from(grid().querySelectorAll('[tabindex="0"]'));
const classesOf = (element: Element): string => element.className;

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
});

describe('HeatmapGrid', () => {
  it('is a table with headers: a grid with a caption, column and row headers and a cell for every column', () => {
    renderWithProviders(<HeatmapGrid {...BASE} rows={FLAT_ROWS} />);
    const table = screen.getByRole('grid', { name: 'Mention rate by topic and engine' });
    expect(table.tagName).toBe('TABLE');
    expect(within(table).getByText('Mention rate by topic and engine', { selector: 'caption' })).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Topic', 'Prompts', 'ChatGPT', 'Gemini', 'Claude']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(['CRM', 'Email']);
    const crm = within(table).getByRole('rowheader', { name: 'CRM' }).closest('tr');
    // The Prompts count and one cell for each engine
    expect(within(crm as HTMLElement).getAllByRole('gridcell')).toHaveLength(1 + COLUMNS.length);
    expect(within(crm as HTMLElement).getByRole('gridcell', { name: '17' })).toBeInTheDocument();
  });

  it('is a treegrid when a row has children, and a grid when none has', () => {
    const { rerender } = renderWithProviders(<HeatmapGrid {...BASE} />);
    expect(screen.getByRole('treegrid')).toBeInTheDocument();
    rerender(<HeatmapGrid {...BASE} rows={FLAT_ROWS} />);
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.queryByRole('treegrid')).toBeNull();
    // A plain grid carries no tree attributes
    for (const row of screen.getAllByRole('row')) {
      expect(row).not.toHaveAttribute('aria-level');
    }
  });

  it('hatched insufficient cells never show a number or a colour bin', () => {
    renderWithProviders(<HeatmapGrid {...BASE} />);
    const cell = cellNamed(CRM_GEMINI);
    expect(cell).toHaveTextContent('3 ans');
    expect(cell).not.toHaveTextContent('75%');
    expect(classesOf(cell)).toContain('bg-insufficient');
    expect(classesOf(cell)).not.toMatch(/seq-|div-/);
    expect(cell.innerHTML).not.toMatch(/seq-|div-/);
  });

  it('unknown is never zero: a cell without answers reads n/a on the surface, with no fill', () => {
    renderWithProviders(<HeatmapGrid {...BASE} />);
    const cell = cellNamed(CRM_CLAUDE);
    expect(cell).toHaveTextContent('n/a');
    expect(cell).not.toHaveTextContent('0%');
    expect(classesOf(cell)).toContain('bg-surface');
    expect(classesOf(cell)).not.toMatch(/seq-|div-|insufficient/);
  });

  it('fills a rate from the bin of the whole percent it prints', () => {
    renderWithProviders(<HeatmapGrid {...BASE} rows={FLAT_ROWS} />);
    expect(classesOf(cellNamed(CRM_CHATGPT))).toContain('bg-seq-5');
    expect(classesOf(cellNamed('Email on ChatGPT: 5%, 2 of 40 answers'))).toContain('bg-seq-2');
    expect(classesOf(cellNamed('Email on Gemini: 80%, 32 of 40 answers'))).toContain('bg-seq-7');
    expect(classesOf(cellNamed('Email on Claude: 0%, 0 of 40 answers'))).toContain('bg-seq-1');
  });

  it('colours a change only when it is detectable', () => {
    const change = (tip: string, value: number, detectable: boolean | null): HeatCell => ({
      value,
      answers: 40,
      state: 'ok',
      text: `${value > 0 ? '+' : ''}${String(value)} pts`,
      tip,
      detectable,
    });
    const rows: readonly HeatRow[] = [
      {
        id: 'crm',
        label: 'CRM',
        name: 'CRM',
        cells: [
          change('CRM on ChatGPT: +18 pts, detectable', 18, true),
          change('CRM on Gemini: +18 pts, not', 18, false),
        ],
      },
    ];
    renderWithProviders(<HeatmapGrid {...BASE} scale="diverging" columns={COLUMNS.slice(0, 2)} rows={rows} />);
    expect(classesOf(cellNamed('CRM on ChatGPT: +18 pts, detectable'))).toContain('bg-div-pos-3');
    expect(classesOf(cellNamed('CRM on Gemini: +18 pts, not'))).toContain('bg-div-zero');
  });

  it('names every cell by its tip, with its counts, and shows the same tip on focus', async () => {
    const { user } = renderWithProviders(<HeatmapGrid {...BASE} rows={FLAT_ROWS} />);
    for (const tip of [CRM_CHATGPT, CRM_GEMINI, CRM_CLAUDE, 'Email on Gemini: 80%, 32 of 40 answers']) {
      expect(cellNamed(tip)).toBeInTheDocument();
    }
    // A linked cell is a link with the same name
    expect(screen.getByRole('link', { name: CRM_CHATGPT })).toHaveAttribute('href', CRM_HREF);
    expect(CRM_CHATGPT).toMatch(/64 of 136 answers/);
    // Row header, then Prompts, then the first engine
    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('link', { name: CRM_CHATGPT })).toHaveFocus();
    expect((await screen.findByText(CRM_CHATGPT)).closest('[data-slot="tooltip"]')).not.toBeNull();
  });

  describe('the 36 px rule', () => {
    class StubObserver {
      static instances: StubObserver[] = [];
      readonly targets: Element[] = [];
      constructor(readonly callback: ResizeObserverCallback) {
        StubObserver.instances.push(this);
      }
      observe(target: Element): void {
        this.targets.push(target);
      }
      unobserve(): void {}
      disconnect(): void {}
    }

    const report = (observer: StubObserver, width: number): void => {
      const target = observer.targets[0] as Element;
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect);
      act(() => {
        observer.callback([{ target } as ResizeObserverEntry], observer as unknown as ResizeObserver);
      });
    };

    it('hides the text under 36 px and keeps it from 36 px, and the names stay', () => {
      StubObserver.instances = [];
      vi.stubGlobal('ResizeObserver', StubObserver);
      renderWithProviders(<HeatmapGrid {...BASE} rows={FLAT_ROWS} />);
      // One observer, on the first data column header
      expect(StubObserver.instances).toHaveLength(1);
      const observer = StubObserver.instances[0] as StubObserver;
      expect(observer.targets).toEqual([screen.getByRole('columnheader', { name: 'ChatGPT' })]);
      // No layout yet (width 0): the text is drawn
      expect(cellNamed(CRM_CHATGPT)).toHaveTextContent('47%');
      report(observer, 35);
      expect(cellNamed(CRM_CHATGPT)).not.toHaveTextContent('47%');
      expect(cellNamed(CRM_GEMINI)).not.toHaveTextContent('3 ans');
      expect(classesOf(cellNamed(CRM_CHATGPT))).toContain('bg-seq-5');
      report(observer, 36);
      expect(cellNamed(CRM_CHATGPT)).toHaveTextContent('47%');
      expect(cellNamed(CRM_GEMINI)).toHaveTextContent('3 ans');
    });
  });

  it('opens tree rows in place, with their level, set size and position', async () => {
    const { user } = renderWithProviders(<HeatmapGrid {...BASE} />);
    const open = screen.getByRole('button', { name: 'Expand CRM' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('rowheader', { name: 'Startups' })).toBeNull();
    const crmRow = screen.getByRole('rowheader', { name: 'CRM' }).closest('tr');
    expect(crmRow).toHaveAttribute('aria-level', '1');
    expect(crmRow).toHaveAttribute('aria-setsize', '2');
    expect(crmRow).toHaveAttribute('aria-posinset', '1');
    // A row without children never carries aria-expanded
    expect(screen.getByRole('rowheader', { name: 'Email' }).closest('tr')).not.toHaveAttribute('aria-expanded');
    await user.click(open);
    const child = screen.getByRole('rowheader', { name: 'Startups' }).closest('tr');
    expect(child).toHaveAttribute('aria-level', '2');
    expect(child).toHaveAttribute('aria-setsize', '1');
    expect(child).toHaveAttribute('aria-posinset', '1');
    expect(cellNamed(STARTUPS_CHATGPT)).toBeInTheDocument();
    const collapse = screen.getByRole('button', { name: 'Collapse CRM' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await user.click(collapse);
    expect(screen.queryByRole('rowheader', { name: 'Startups' })).toBeNull();
  });

  it('has one tab stop and the keyboard path of a grid and of a tree', async () => {
    const { user } = renderWithProviders(<HeatmapGrid {...BASE} />);
    expect(tabStops()).toHaveLength(1);
    await user.tab();
    const crmHeader = screen.getByRole('rowheader', { name: 'CRM' });
    expect(crmHeader).toHaveFocus();
    // Right on this row header opens the row, so End and Left reach the row's own cells
    await user.keyboard('{End}');
    expect(cellNamed(CRM_CLAUDE)).toHaveFocus();
    expect(tabStops()).toEqual([cellNamed(CRM_CLAUDE)]);
    await user.keyboard('{ArrowLeft}');
    expect(cellNamed(CRM_GEMINI)).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('link', { name: CRM_CHATGPT })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(cellNamed('Email on ChatGPT: 5%, 2 of 40 answers')).toHaveFocus();
    expect(tabStops()).toHaveLength(1);
    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(cellNamed('17')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(crmHeader).toHaveFocus();
    // Right opens a closed row, then moves to its first child; Left goes back, then closes
    await user.keyboard('{ArrowRight}');
    expect(crmHeader.closest('tr')).toHaveAttribute('aria-expanded', 'true');
    expect(crmHeader).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('rowheader', { name: 'Startups' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(crmHeader).toHaveFocus();
    expect(crmHeader.closest('tr')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(crmHeader.closest('tr')).toHaveAttribute('aria-expanded', 'false');
    expect(tabStops()).toEqual([crmHeader]);
    // Ctrl+End is the last cell of the last row
    await user.keyboard('{Control>}{End}{/Control}');
    expect(cellNamed('Email on Claude: 0%, 0 of 40 answers')).toHaveFocus();
  });

  it('follows the link of a cell on Enter', async () => {
    const { user } = renderWithProviders(<HeatmapGrid {...BASE} />);
    const link = screen.getByRole('link', { name: CRM_CHATGPT });
    // jsdom cannot navigate: the click is what a browser would follow
    const followed = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', followed);
    await user.tab();
    await user.keyboard('{End}{ArrowLeft}{ArrowLeft}{Enter}');
    expect(followed).toHaveBeenCalledOnce();
  });

  it('draws a 2 px rule before the columns that start after a version boundary', () => {
    renderWithProviders(<HeatmapGrid {...BASE} rows={FLAT_ROWS} boundaries={[2]} />);
    const rule = 'border-l-2';
    expect(classesOf(screen.getByRole('columnheader', { name: 'Claude' }))).toContain(rule);
    expect(classesOf(screen.getByRole('columnheader', { name: 'Claude' }))).toContain('border-foreground-muted');
    expect(classesOf(cellNamed(CRM_CLAUDE))).toContain(rule);
    expect(classesOf(cellNamed(CRM_CLAUDE))).toContain('border-foreground-muted');
    expect(classesOf(cellNamed(CRM_GEMINI))).not.toContain(rule);
    expect(classesOf(screen.getByRole('columnheader', { name: 'Gemini' }))).not.toContain(rule);
  });

  it('sets the row height by density', () => {
    const { rerender } = renderWithProviders(<HeatmapGrid {...BASE} rows={FLAT_ROWS} density="compact" />);
    const rowOf = (): Element | null => screen.getByRole('rowheader', { name: 'CRM' }).closest('tr');
    expect(classesOf(rowOf() as Element)).toContain('h-row-compact');
    rerender(<HeatmapGrid {...BASE} rows={FLAT_ROWS} density="default" />);
    expect(classesOf(rowOf() as Element)).toMatch(/(^| )h-row( |$)/);
    expect(classesOf(rowOf() as Element)).not.toContain('h-row-compact');
  });

  it('is the Table view in the table form: no fill, each cell prints its tip', () => {
    const { container } = renderWithProviders(<HeatmapGrid {...BASE} rows={FLAT_ROWS} form="table" />);
    expect(container.innerHTML).not.toMatch(/bg-(seq|div|insufficient)/);
    expect(cellNamed(CRM_CHATGPT)).toHaveTextContent(CRM_CHATGPT);
    expect(cellNamed(CRM_GEMINI)).toHaveTextContent(CRM_GEMINI);
    expect(cellNamed(CRM_CLAUDE)).toHaveTextContent(CRM_CLAUDE);
    expect(container).not.toHaveTextContent('75%');
    // No key of fills without fills
    expect(screen.queryByRole('list', { name: 'Key to the cell fills' })).toBeNull();
  });

  it('keys the fills under the table, with the bounds and the two kinds of cell without a rate', () => {
    const { rerender } = renderWithProviders(<HeatmapGrid {...BASE} />);
    const key = screen.getByRole('list', { name: 'Key to the cell fills' });
    expect(
      within(key)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '0%',
      'Under 10%',
      '10% to 20%',
      '20% to 35%',
      '35% to 50%',
      '50% to 70%',
      '70% and up',
      'Fewer than 4 answers',
      'No answers',
    ]);
    expect(key.innerHTML).toContain('forced-color-adjust-none');
    rerender(<HeatmapGrid {...BASE} scale="diverging" />);
    const diverging = screen.getByRole('list', { name: 'Key to the cell fills' });
    expect(within(diverging).getAllByRole('listitem')).toHaveLength(9);
    expect(within(diverging).getByText('Within normal variation')).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)(
    'has no axe violations in %s, with a hatched, a none and an open row',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { user, container } = renderWithProviders(<HeatmapGrid {...BASE} boundaries={[1]} />);
      await user.click(screen.getByRole('button', { name: 'Expand CRM' }));
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('has no axe violations in the table form', async () => {
    const { container } = renderWithProviders(<HeatmapGrid {...BASE} form="table" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('HeatmapGrid in ChartFrame', () => {
  const FRAME = {
    title: 'Mention rate by topic and engine',
    variant: 'panel' as const,
    kind: 'html' as const,
    height: 180 as const,
    summary: 'CRM is named in 47 percent of ChatGPT answers.',
    body: <HeatmapGrid {...BASE} />,
    table: <HeatmapGrid {...BASE} form="table" />,
  };

  it('shows the grid when ready, and the table form on Table', async () => {
    const { user } = renderWithProviders(<ChartFrame {...FRAME} status="ready" />);
    expect(grid()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(cellNamed(CRM_CHATGPT)).toHaveTextContent(CRM_CHATGPT);
  });

  it('shows no grid while loading, and the reason and action when empty', () => {
    const { rerender } = renderWithProviders(<ChartFrame {...FRAME} status="loading" />);
    expect(screen.queryByRole('treegrid')).toBeNull();
    rerender(
      <ChartFrame
        {...FRAME}
        status="empty"
        empty={{
          title: 'No topics yet',
          reason: 'Group prompts into topics to see where you are strong.',
          action: <button type="button">Assign topics</button>,
        }}
      />,
    );
    expect(screen.queryByRole('treegrid')).toBeNull();
    expect(screen.getByText('Group prompts into topics to see where you are strong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign topics' })).toBeInTheDocument();
  });

  it('shows the error with a retry that calls onRetry', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <ChartFrame
        {...FRAME}
        status="error"
        error={{
          title: 'Could not load the topics',
          reason: 'The server returned an error.',
          errorId: null,
          onRetry,
          retrying: false,
          retryLabel: 'Try again',
        }}
      />,
    );
    expect(screen.queryByRole('treegrid')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps the grid while it refetches, and says stale and partial next to the title', async () => {
    const { rerender } = renderWithProviders(<ChartFrame {...FRAME} status="refetching" />);
    expect(grid()).toBeInTheDocument();
    rerender(
      <ChartFrame
        {...FRAME}
        meta="Last 28 days"
        notice={{ kind: 'stale', text: 'Stale: last collected Sep 27, 18:30 CEST' }}
        status="ready"
      />,
    );
    expect(screen.getByText('Last 28 days').parentElement).toHaveTextContent('Stale: last collected Sep 27');
    rerender(
      <ChartFrame
        {...FRAME}
        notice={{ kind: 'partial', text: 'Partial data: 612 of 1,000 prompts asked' }}
        status="ready"
      />,
    );
    await waitFor(() => expect(screen.getByText('Partial data: 612 of 1,000 prompts asked')).toBeInTheDocument());
    expect(grid()).toBeInTheDocument();
  });
});
