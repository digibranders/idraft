import { readFileSync } from 'node:fs';
import path from 'node:path';

import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartFrame } from './chart-frame';
import {
  LABEL_ON,
  ShareBarCell,
  StackedShareBar,
  StackedShareTable,
  stackedShareCsv,
  type ShareCell,
  type ShareColor,
  type ShareRow,
  type ShareSegment,
  type StackedShareBarProps,
} from './stacked-share-bar';
import { contrastRatio, meetsContrast, parseColor, type LinearColor } from '@/lib/design/contrast';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const SEGMENTS: readonly ShareSegment[] = [
  { id: 'both', name: 'Named and cited', color: 'chart-4' },
  { id: 'named', name: 'Named only', color: 'chart-2' },
  { id: 'cited', name: 'Cited only', color: 'chart-3' },
  { id: 'neither', name: 'Neither', color: 'chart-other' },
];

/** A cell of 1,296 answers, as the consumers write it. */
const cell = (segmentId: string, share: number, shareText: string, count: number): ShareCell => ({
  segmentId,
  share,
  shareText,
  countText: `${String(count)} of 1,296`,
});

const GEMINI: ShareRow = {
  id: 'gemini',
  label: 'Gemini',
  denominatorText: 'of 1,296 answers',
  href: '/prompts?engine=gemini' as Route,
  value: {
    kind: 'shares',
    cells: [
      cell('both', 432 / 1296, '33%', 432),
      cell('named', 270 / 1296, '21%', 270),
      cell('cited', 162 / 1296, '13%', 162),
      cell('neither', 432 / 1296, '33%', 432),
    ],
  },
};
const CHATGPT: ShareRow = {
  id: 'chatgpt',
  label: 'ChatGPT',
  denominatorText: 'of 1,296 answers',
  href: '/prompts?engine=chatgpt' as Route,
  value: {
    kind: 'shares',
    cells: [
      cell('both', 648 / 1296, '50%', 648),
      cell('named', 324 / 1296, '25%', 324),
      cell('cited', 162 / 1296, '13%', 162),
      cell('neither', 162 / 1296, '13%', 162),
    ],
  },
};
const THIN: ShareRow = {
  id: 'ai-mode',
  label: 'AI Mode',
  denominatorText: 'of 3 answers',
  value: { kind: 'thin', answers: 3 },
};
const NONE: ShareRow = {
  id: 'copilot',
  label: 'Copilot',
  denominatorText: 'of 0 answers',
  value: { kind: 'none', text: 'Not asked in this window' },
};
/** No cell for "Cited only": that outcome is unknown for this row (R6), not zero. */
const MISSING: ShareRow = {
  id: 'missing',
  label: 'Perplexity',
  denominatorText: 'of 1,296 answers',
  value: {
    kind: 'shares',
    cells: [cell('both', 0.5, '50%', 648), cell('named', 0.25, '25%', 324), cell('neither', 0.25, '25%', 324)],
  },
};
/** A real zero of a known total. */
const ZERO: ShareRow = {
  id: 'zero',
  label: 'Claude',
  denominatorText: 'of 1,296 answers',
  value: {
    kind: 'shares',
    cells: [
      cell('both', 0.5, '50%', 648),
      cell('named', 0.25, '25%', 324),
      cell('cited', 0, '0%', 0),
      cell('neither', 0.25, '25%', 324),
    ],
  },
};
/** Shares of 0.06 (drawn) and 0.05 (too narrow to hold a label). */
const NARROW: ShareRow = {
  id: 'narrow',
  label: 'Edge',
  denominatorText: 'of 100 answers',
  value: {
    kind: 'shares',
    cells: [
      { segmentId: 'both', share: 0.5, shareText: '50%', countText: '50 of 100' },
      { segmentId: 'named', share: 0.06, shareText: '6%', countText: '6 of 100' },
      { segmentId: 'cited', share: 0.05, shareText: '5%', countText: '5 of 100' },
      { segmentId: 'neither', share: 0.39, shareText: '39%', countText: '39 of 100' },
    ],
  },
};

const CAPTION = 'Named and cited, by engine';
const props = (overrides: Partial<StackedShareBarProps> = {}): StackedShareBarProps => ({
  caption: CAPTION,
  segments: SEGMENTS,
  rows: [GEMINI, CHATGPT, THIN, NONE],
  segmentHeader: 'Outcome',
  patterns: false,
  ...overrides,
});

const thinText = (answers: number): string => `${String(answers)} answers`;

const bar = (row: ShareRow): HTMLElement => screen.getByRole('img', { name: new RegExp(`^${row.label}:`) });
const segmentsOf = (element: HTMLElement): HTMLElement[] =>
  Array.from(element.querySelectorAll<HTMLElement>('[data-slot="share-segment"]'));
/** Narrows an indexed element: a missing one fails the test with a message instead of a cast. */
const present = (element: HTMLElement | undefined): HTMLElement => {
  if (element === undefined) throw new Error('expected an element');
  return element;
};

afterEach(() => {
  document.documentElement.className = '';
  vi.unstubAllGlobals();
});

/** A bar of the measured width: the stub reports it as soon as the bar is observed. */
function stubBarWidth(width: number): void {
  class BarObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [{ target, contentRect: { width, height: 32 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', BarObserver);
}

describe('StackedShareBar bars', () => {
  it('draws the segments in the order of `segments`, each growing by its share, with a hairline between', () => {
    renderWithProviders(<StackedShareBar {...props()} />);
    const segments = segmentsOf(bar(GEMINI));
    expect(segments.map((segment) => segment.dataset['segment'])).toEqual(['both', 'named', 'cited', 'neither']);
    expect(segments.map((segment) => Number(segment.style.flexGrow))).toEqual([
      432 / 1296,
      270 / 1296,
      162 / 1296,
      432 / 1296,
    ]);
    expect(bar(GEMINI)).toHaveClass('flex', 'gap-px', 'overflow-hidden', 'rounded-md');
    expect(segments[0]).toHaveClass('bg-chart-4');
    for (const segment of segments) expect(segment).toHaveAttribute('aria-hidden', 'true');
  });

  it('names the bar with its row, every segment with its share and count, and the denominator (R1, R12)', () => {
    renderWithProviders(<StackedShareBar {...props()} />);
    expect(bar(GEMINI)).toHaveAccessibleName(
      'Gemini: Named and cited 33%, 432 of 1,296, Named only 21%, 270 of 1,296, Cited only 13%, 162 of 1,296, and Neither 33%, 432 of 1,296, of 1,296 answers',
    );
    expect(screen.getByRole('list', { name: CAPTION })).toBeInTheDocument();
    expect(screen.getAllByText('of 1,296 answers').length).toBeGreaterThan(0);
  });

  it('writes the share inside a segment of 0.06 and more, and not inside a narrower one', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [NARROW] })} />);
    const [both, named, cited, neither] = segmentsOf(bar(NARROW));
    expect(both).toHaveTextContent('50%');
    expect(named).toHaveTextContent('6%');
    expect(cited).toHaveTextContent('');
    expect(neither).toHaveTextContent('39%');
    expect(within(present(both)).getByText('50%')).toHaveClass('type-micro', 'num');
  });

  describe('label width in pixels', () => {
    /** Shares of 0.1 and 0.05 (and 0.85): 20 px and 10 px of a 200 px bar, 100 px and 50 px of a 1,000 px one. */
    const TIGHT: ShareRow = {
      id: 'tight',
      label: 'Outcome mix',
      denominatorText: 'of 100 answers',
      value: {
        kind: 'shares',
        cells: [
          { segmentId: 'both', share: 0.1, shareText: '10%', countText: '10 of 100' },
          { segmentId: 'named', share: 0.05, shareText: '5%', countText: '5 of 100' },
          { segmentId: 'neither', share: 0.85, shareText: '85%', countText: '85 of 100' },
        ],
      },
    };

    it('draws no label in a segment narrower than 40 px, and keeps its share and count in the name and the table', () => {
      stubBarWidth(200);
      renderWithProviders(<StackedShareBar {...props({ rows: [TIGHT] })} />);
      const [both, named, neither] = segmentsOf(bar(TIGHT));
      expect(both).toHaveTextContent('');
      expect(named).toHaveTextContent('');
      expect(neither).toHaveTextContent('85%');
      expect(bar(TIGHT)).toHaveAccessibleName(expect.stringContaining('Named and cited 10%, 10 of 100'));
      const table = screen.getByRole('table', { name: CAPTION });
      expect(within(within(table).getByRole('row', { name: /Named and cited/ })).getByRole('cell')).toHaveTextContent(
        '10%, 10 of 100',
      );
    });

    it('draws the label of the same segment when the bar is wide enough for 40 px', () => {
      stubBarWidth(1000);
      renderWithProviders(<StackedShareBar {...props({ rows: [TIGHT] })} />);
      const [both, named] = segmentsOf(bar(TIGHT));
      expect(both).toHaveTextContent('10%');
      expect(named).toHaveTextContent('5%');
    });

    it('falls back to the share of the bar when the width is unknown or 0', () => {
      renderWithProviders(<StackedShareBar {...props({ rows: [TIGHT] })} />);
      const [both, named] = segmentsOf(bar(TIGHT));
      expect(both).toHaveTextContent('10%');
      expect(named).toHaveTextContent('');
    });

    it('treats a measured width of 0 as unknown', () => {
      stubBarWidth(0);
      renderWithProviders(<StackedShareBar {...props({ rows: [TIGHT] })} />);
      const [both, named] = segmentsOf(bar(TIGHT));
      expect(both).toHaveTextContent('10%');
      expect(named).toHaveTextContent('');
    });
  });

  it('colours each inside label from the map of its segment colour', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [GEMINI] })} />);
    const [both, named] = segmentsOf(bar(GEMINI));
    for (const token of (LABEL_ON['chart-4'] ?? '').split(' ')) {
      expect(within(present(both)).getByText('33%')).toHaveClass(token);
    }
    for (const token of (LABEL_ON['chart-2'] ?? '').split(' ')) {
      expect(within(present(named)).getByText('21%')).toHaveClass(token);
    }
  });

  it('is shorter in the compact density', () => {
    const { rerender } = renderWithProviders(<StackedShareBar {...props({ rows: [GEMINI] })} />);
    expect(bar(GEMINI)).toHaveClass('h-8');
    rerender(<StackedShareBar {...props({ rows: [GEMINI], density: 'compact' })} />);
    expect(bar(GEMINI)).toHaveClass('h-6');
    expect(bar(GEMINI)).not.toHaveClass('h-8');
  });
});

describe('StackedShareBar honesty', () => {
  it('says the answers of a thin row and draws no bar and no percent (R2)', () => {
    renderWithProviders(<StackedShareBar {...props()} />);
    expect(screen.queryByRole('img', { name: /AI Mode/ })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: CAPTION });
    expect(within(list).getByText('3 answers')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: CAPTION });
    expect(within(table).getAllByText('3 answers')).toHaveLength(SEGMENTS.length);
    expect(
      within(table)
        .getAllByText('3 answers')
        .every((cell) => !/%/.test(cell.textContent)),
    ).toBe(true);
  });

  it('says the reason of a row with nothing known and draws no bar (R6)', () => {
    renderWithProviders(<StackedShareBar {...props()} />);
    expect(screen.queryByRole('img', { name: /Copilot/ })).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: CAPTION });
    expect(within(list).getByText('Not asked in this window')).toBeInTheDocument();
  });

  it('says "No data" for a default reason', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [{ ...NONE, value: { kind: 'none' } }] })} />);
    expect(within(screen.getByRole('list', { name: CAPTION })).getByText('No data')).toBeInTheDocument();
  });

  it('draws no segment for an outcome without a cell, and no segment for a real zero', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [MISSING, ZERO] })} />);
    expect(segmentsOf(bar(MISSING)).map((segment) => segment.dataset['segment'])).toEqual(['both', 'named', 'neither']);
    expect(segmentsOf(bar(ZERO)).map((segment) => segment.dataset['segment'])).toEqual(['both', 'named', 'neither']);
  });

  it('leaves the bar of an unknown outcome short: the shares keep their size, not scaled to 100%', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [MISSING] })} />);
    expect(segmentsOf(bar(MISSING)).map((segment) => Number(segment.style.flexGrow))).toEqual([0.5, 0.25, 0.25]);
  });

  it('says in the image name that an unknown outcome is unknown, and a real zero is a number', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [MISSING, ZERO] })} />);
    expect(bar(MISSING)).toHaveAccessibleName(
      'Perplexity: Named and cited 50%, 648 of 1,296, Named only 25%, 324 of 1,296, Cited only: No data, and Neither 25%, 324 of 1,296, of 1,296 answers',
    );
    expect(bar(ZERO)).toHaveAccessibleName(expect.stringContaining('Cited only 0%, 0 of 1,296'));
    expect(bar(ZERO)).not.toHaveAccessibleName(expect.stringContaining('No data'));
  });

  it('says "No data" for a row of shares without a cell, in the list and in the table', () => {
    const empty: ShareRow = { ...GEMINI, value: { kind: 'shares', cells: [] } };
    renderWithProviders(<StackedShareBar {...props({ rows: [empty] })} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: CAPTION })).getByText('No data')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: CAPTION });
    const cells = within(table).getAllByRole('cell');
    expect(cells).toHaveLength(SEGMENTS.length);
    for (const entry of cells) expect(entry).toHaveTextContent('No data');
  });

  it('keeps an unknown outcome apart from a zero in the legend table', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [MISSING, ZERO] })} />);
    const table = screen.getByRole('table', { name: CAPTION });
    const cited = within(table).getByRole('row', { name: /Cited only/ });
    const cells = within(cited).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('No data');
    expect(cells[0]).not.toHaveTextContent('0%');
    expect(cells[1]).toHaveTextContent('0%, 0 of 1,296');
  });

  it('puts every percent in the table beside its count (R1)', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [GEMINI] })} />);
    const table = screen.getByRole('table', { name: CAPTION });
    const both = within(table).getByRole('row', { name: /Named and cited/ });
    expect(within(both).getByRole('cell')).toHaveTextContent('33%, 432 of 1,296');
  });
});

describe('StackedShareBar patterns', () => {
  it('lays one pattern over each segment and each legend swatch, the same kind for the same segment', () => {
    const { container } = renderWithProviders(<StackedShareBar {...props({ rows: [GEMINI], patterns: true })} />);
    const segments = segmentsOf(bar(GEMINI));
    const kinds = segments.map((segment) => segment.querySelector('svg')?.dataset['pattern']);
    expect(kinds.every((kind) => typeof kind === 'string')).toBe(true);
    expect(new Set(kinds).size).toBe(segments.length);
    const swatches = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="share-swatch"]'));
    expect(swatches).toHaveLength(SEGMENTS.length);
    expect(swatches.map((swatch) => swatch.querySelector('svg')?.dataset['pattern'])).toEqual(
      SEGMENTS.map((segment) => {
        const index = segments.findIndex((entry) => entry.dataset['segment'] === segment.id);
        return kinds[index];
      }),
    );
    for (const overlay of container.querySelectorAll('svg')) expect(overlay).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives two bars on one page different pattern ids', () => {
    const { container } = renderWithProviders(
      <>
        <StackedShareBar {...props({ rows: [GEMINI], patterns: true })} />
        <StackedShareBar {...props({ rows: [CHATGPT], patterns: true })} />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('pattern')).map((pattern) => pattern.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id !== '')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('draws none when patterns are off', () => {
    const { container } = renderWithProviders(<StackedShareBar {...props({ patterns: false })} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('pattern')).toBeNull();
  });

  it('sits each inside label on a solid chip of its segment fill, so no stroke passes behind the glyphs', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [GEMINI], patterns: true })} />);
    const [both, named] = segmentsOf(bar(GEMINI));
    const label = within(present(both)).getByText('33%');
    expect(label).toHaveClass('bg-chart-4', 'px-1', 'rounded-2xs', 'type-micro');
    expect(within(present(named)).getByText('21%')).toHaveClass('bg-chart-2');
    // the chip is above the overlay in paint order: the svg comes first, the label after it
    expect(present(both).firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(present(both).lastElementChild).toContainElement(label);
  });

  it('keeps the pattern kind of a segment when an earlier outcome has no cell', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [GEMINI, MISSING], patterns: true })} />);
    const kindOf = (row: ShareRow, id: string): string | undefined =>
      segmentsOf(bar(row))
        .find((segment) => segment.dataset['segment'] === id)
        ?.querySelector('svg')?.dataset['pattern'];
    expect(kindOf(MISSING, 'neither')).toBe(kindOf(GEMINI, 'neither'));
  });
});

describe('StackedShareBar links and keyboard', () => {
  it('reaches the rows with an address in order, with the focus ring, and nothing else', async () => {
    const { user, container } = renderWithProviders(<StackedShareBar {...props()} />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Gemini', 'ChatGPT']);
    expect(links[0]).toHaveAttribute('href', '/prompts?engine=gemini');
    for (const link of links) expect(link).toHaveClass('focus-visible:focus-ring');
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
    await user.tab();
    expect(links[0]).not.toHaveFocus();
    expect(links[1]).not.toHaveFocus();
    expect(container.querySelectorAll('[data-slot="share-segment"] :is(a, button, [tabindex])')).toHaveLength(0);
    for (const segment of container.querySelectorAll('[data-slot="share-segment"]')) {
      expect(segment).not.toHaveAttribute('tabindex');
    }
  });

  it('keeps a row without an address as plain text', () => {
    renderWithProviders(<StackedShareBar {...props({ rows: [THIN] })} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: CAPTION })).getByText('AI Mode')).toBeInTheDocument();
  });
});

describe('StackedShareTable', () => {
  it('has a caption, the segment header, then a column for each row label', () => {
    renderWithProviders(<StackedShareTable {...props()} />);
    const table = screen.getByRole('table', { name: CAPTION });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Outcome', 'Gemini', 'ChatGPT', 'AI Mode', 'Copilot']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(SEGMENTS.map((segment) => segment.name));
  });

  it('writes one cell for each row of each outcome: shares with counts, thin, and no data', () => {
    renderWithProviders(<StackedShareTable {...props()} />);
    const table = screen.getByRole('table', { name: CAPTION });
    const named = within(table).getByRole('row', { name: /Named only/ });
    expect(
      within(named)
        .getAllByRole('cell')
        .map((entry) => entry.textContent),
    ).toEqual(['21%, 270 of 1,296', '25%, 324 of 1,296', '3 answers', 'Not asked in this window']);
  });

  it('shows the swatch of each outcome in its row, with a pattern only when asked', () => {
    const { container, rerender } = renderWithProviders(<StackedShareTable {...props()} />);
    const swatches = container.querySelectorAll('[data-slot="share-swatch"]');
    expect(swatches).toHaveLength(SEGMENTS.length);
    expect(swatches[0]).toHaveClass('bg-chart-4', 'size-2');
    expect(swatches[0]?.querySelector('svg')).toBeNull();
    rerender(<StackedShareTable {...props({ patterns: true })} />);
    const patterned = container.querySelectorAll('[data-slot="share-swatch"]');
    expect(patterned[0]).toHaveClass('size-4');
    expect(patterned[0]?.querySelector('svg')).not.toBeNull();
  });

  it('is drawn under the bars of StackedShareBar, always', () => {
    renderWithProviders(<StackedShareBar {...props()} />);
    const list = screen.getByRole('list', { name: CAPTION });
    const table = screen.getByRole('table', { name: CAPTION });
    expect(list.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('stackedShareCsv', () => {
  it('writes the header and the cells, an empty cell for an unknown outcome', () => {
    const table = stackedShareCsv(props({ rows: [GEMINI, MISSING, THIN, NONE] }), thinText);
    expect(table.header).toEqual(['Outcome', 'Gemini', 'Perplexity', 'AI Mode', 'Copilot']);
    expect(table.rows).toEqual([
      ['Named and cited', '33%, 432 of 1,296', '50%, 648 of 1,296', '3 answers', null],
      ['Named only', '21%, 270 of 1,296', '25%, 324 of 1,296', '3 answers', null],
      ['Cited only', '13%, 162 of 1,296', null, '3 answers', null],
      ['Neither', '33%, 432 of 1,296', '25%, 324 of 1,296', '3 answers', null],
    ]);
  });

  it('writes a real zero as text', () => {
    const table = stackedShareCsv(props({ rows: [ZERO] }), thinText);
    expect(table.rows[2]).toEqual(['Cited only', '0%, 0 of 1,296']);
  });

  it('writes every header and cell that a spreadsheet could read as a formula as text', () => {
    const table = stackedShareCsv(
      props({
        segmentHeader: '=Outcome',
        segments: [{ id: 'a', name: '+Named', color: 'chart-2' }],
        rows: [
          { ...GEMINI, label: '=cmd', value: { kind: 'shares', cells: [cell('a', 1, '+100%', 1296)] } },
          { ...THIN, label: '-thin' },
        ],
      }),
      (answers) => `@${String(answers)} answers`,
    );
    expect(table.header).toEqual(["'=Outcome", "'=cmd", "'-thin"]);
    expect(table.rows).toEqual([["'+Named", "'+100%, 1296 of 1,296", "'@3 answers"]]);
  });
});

describe('ShareBarCell', () => {
  const cellProps = {
    label: 'Gemini',
    segments: SEGMENTS,
    cells: [
      cell('both', 432 / 1296, '33%', 432),
      cell('named', 270 / 1296, '21%', 270),
      cell('cited', 162 / 1296, '13%', 162),
      cell('neither', 432 / 1296, '33%', 432),
    ],
    denominatorText: 'of 1,296 answers',
  };

  it('is one 96 by 12 px image named with every segment and the denominator, with no label', () => {
    const { container } = renderWithProviders(<ShareBarCell {...cellProps} />);
    const image = screen.getByRole('img', { name: /^Gemini:/ });
    expect(image).toHaveAccessibleName(
      'Gemini: Named and cited 33%, 432 of 1,296, Named only 21%, 270 of 1,296, Cited only 13%, 162 of 1,296, and Neither 33%, 432 of 1,296, of 1,296 answers',
    );
    expect(image).toHaveClass('h-3', 'w-24', 'flex', 'gap-px', 'overflow-hidden');
    expect(image).toHaveTextContent('');
    expect(segmentsOf(image)).toHaveLength(4);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('says "No data" and draws no empty bar when it has no cell', () => {
    const { container } = renderWithProviders(<ShareBarCell {...cellProps} cells={[]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('No data');
  });

  it('names an outcome without a cell as unknown', () => {
    renderWithProviders(
      <ShareBarCell
        {...cellProps}
        cells={[cell('both', 0.5, '50%', 648), cell('named', 0.25, '25%', 324), cell('neither', 0.25, '25%', 324)]}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(expect.stringContaining('Cited only: No data'));
  });

  it('has nothing to focus', () => {
    const { container } = renderWithProviders(<ShareBarCell {...cellProps} />);
    expect(container.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
  });

  it('draws no segment for an unknown outcome and none for a zero', () => {
    renderWithProviders(
      <ShareBarCell
        {...cellProps}
        cells={[cell('both', 0.5, '50%', 648), cell('named', 0, '0%', 0), cell('neither', 0.5, '50%', 648)]}
      />,
    );
    expect(segmentsOf(screen.getByRole('img')).map((segment) => segment.dataset['segment'])).toEqual([
      'both',
      'neither',
    ]);
  });
});

describe('LABEL_ON', () => {
  const css = readFileSync(path.join(import.meta.dirname, '../../../styles/tokens.css'), 'utf8');
  const block = (opening: string): string => {
    const from = css.indexOf(opening);
    return css.slice(from, css.indexOf('\n}', from));
  };
  const LIGHT = block(':root {');
  const DARK = block('.dark {');
  type Theme = 'light' | 'dark';
  const TEXT_TOKENS = ['foreground', 'foreground-inverse'] as const;
  const THEMES: readonly Theme[] = ['light', 'dark'];
  const REQUIRED = 4.5;

  /** A token as the theme declares it; the dark theme falls back to the light value it does not override. */
  function color(theme: Theme, name: string): LinearColor {
    const declaration = new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`);
    const value = (theme === 'dark' ? declaration.exec(DARK) : null)?.[1] ?? declaration.exec(LIGHT)?.[1];
    const parsed = parseColor(value ?? '');
    if (parsed === null) throw new Error(`could not read --${name} in the ${theme} theme`);
    return parsed;
  }
  /** The text token a class list resolves to in a theme: a `dark:` class wins in the dark theme. */
  function labelToken(classes: string, theme: Theme): string {
    const parts = classes.split(' ');
    const picked =
      (theme === 'dark' ? parts.find((part) => part.startsWith('dark:text-')) : undefined)?.slice(
        'dark:text-'.length,
      ) ?? parts.find((part) => part.startsWith('text-'))?.slice('text-'.length);
    if (picked === undefined) throw new Error(`no text class in "${classes}"`);
    return picked;
  }
  const COLORS: readonly ShareColor[] = [
    'chart-1',
    'chart-2',
    'chart-3',
    'chart-4',
    'chart-5',
    'chart-6',
    'chart-other',
    'rank-band-1',
    'rank-band-2',
    'rank-band-3',
    'rank-band-4',
    'rank-band-5',
    'rank-band-none',
  ];
  const entries = COLORS.map((name): [ShareColor, string | null] => [name, LABEL_ON[name]]);

  it('has an entry for every segment colour', () => {
    expect(Object.keys(LABEL_ON).sort()).toEqual([...COLORS].sort());
  });

  it('reads the tokens file: the light and dark declarations of one segment colour differ', () => {
    expect(contrastRatio(color('light', 'chart-2'), color('dark', 'chart-2'))).toBeGreaterThan(1.5);
  });

  it('gives every label colour 4.5 to 1 on its segment, in both themes', () => {
    for (const [name, classes] of entries) {
      if (classes === null) continue;
      for (const theme of THEMES) {
        const ratio = contrastRatio(color(theme, labelToken(classes, theme)), color(theme, name));
        expect(meetsContrast(ratio, REQUIRED), `${name} in ${theme}: ${ratio.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('leaves a label out only where neither text colour reaches 4.5 to 1 in some theme', () => {
    const nulls = entries.filter(([, classes]) => classes === null);
    expect(nulls.length).toBeGreaterThan(0);
    for (const [name] of nulls) {
      const failsSomewhere = THEMES.some((theme) =>
        TEXT_TOKENS.every((token) => !meetsContrast(contrastRatio(color(theme, token), color(theme, name)), REQUIRED)),
      );
      expect(failsSomewhere, `${name} could carry a label`).toBe(true);
    }
  });

  it('draws no inside label on a segment colour that has none', () => {
    const [none] = entries.find(([, classes]) => classes === null) ?? [];
    expect(none).toBeDefined();
    renderWithProviders(
      <StackedShareBar
        {...props({
          segments: [{ id: 'a', name: 'Only', color: none ?? 'chart-1' }],
          rows: [{ ...GEMINI, value: { kind: 'shares', cells: [cell('a', 1, '100%', 1296)] } }],
        })}
      />,
    );
    expect(segmentsOf(bar(GEMINI))[0]).toHaveTextContent('');
  });
});

describe('StackedShareBar in ChartFrame', () => {
  const share = props({ rows: [GEMINI, CHATGPT] });
  const frame = (
    <ChartFrame
      kind="html"
      title="Named and cited, by engine"
      variant="panel"
      patterns
      height={180}
      summary="Gemini names and cites the brand in 33% of 1,296 answers."
      status="ready"
      body={({ patterns }) => <StackedShareBar {...share} patterns={patterns} />}
      table={<StackedShareTable {...share} />}
      menu={{ fileName: 'named-and-cited', csv: stackedShareCsv(share, thinText) }}
    />
  );

  it('turns the overlays on with Patterns and swaps the bars for the table with Table', async () => {
    const { user, container } = renderWithProviders(frame);
    expect(container.querySelector('svg[data-pattern]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Patterns' }));
    expect(container.querySelector('svg[data-pattern]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.queryByRole('list', { name: CAPTION })).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: CAPTION })).toBeInTheDocument();
  });
});

describe('StackedShareBar accessibility', () => {
  const everything = [GEMINI, CHATGPT, THIN, NONE, MISSING, ZERO];

  it('has no axe violation in the light theme, with patterns on and off', async () => {
    const off = renderWithProviders(<StackedShareBar {...props({ rows: everything })} />);
    expect(await axe(off.container)).toHaveNoViolations();
    off.unmount();
    const on = renderWithProviders(<StackedShareBar {...props({ rows: everything, patterns: true })} />);
    expect(await axe(on.container)).toHaveNoViolations();
  });

  it('has no axe violation in the dark theme, with patterns on and off', async () => {
    document.documentElement.className = 'dark';
    const off = renderWithProviders(<StackedShareBar {...props({ rows: everything })} />);
    expect(await axe(off.container)).toHaveNoViolations();
    off.unmount();
    const on = renderWithProviders(<StackedShareBar {...props({ rows: everything, patterns: true })} />);
    expect(await axe(on.container)).toHaveNoViolations();
  });

  it('has no axe violation for the table cell form', async () => {
    const { container } = renderWithProviders(
      <ShareBarCell
        label="Gemini"
        segments={SEGMENTS}
        cells={[cell('both', 1, '100%', 1296)]}
        denominatorText="of 1,296 answers"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
