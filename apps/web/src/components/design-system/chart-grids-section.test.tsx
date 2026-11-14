import { within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChartGridsSection } from './chart-grids-section';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The canvas stub of the test setup cannot draw: the small multiples mount real charts, so the canvas is stood in for
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

// A whole section holds every variant of two parts, and axe walks all of it
const SECTION_TIMEOUT_MS = 30_000;

/** What a cell's accessible name says about its counts: answers, a thin count, or no answers at all. */
const COUNTED = /\d+ of [\d,]+ answers|\d+ answers?, fewer than \d+|no answers|no engine has a rate|\d+ then \d+/i;

interface Cell {
  /** The visible text of the cell. */
  text: string;
  /** The accessible name, from the cell itself or from the link inside it. */
  name: string;
}

/** The data cells of every heat-map in `root`, row by row; the Prompts column and the row headers are left out. */
function heatCells(root: HTMLElement): Cell[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="grid"], [role="treegrid"]')).flatMap((grid) => {
    const headers = Array.from(grid.querySelectorAll('thead th')).map((header) => header.textContent);
    const skip = headers.includes('Prompts') ? 1 : 0;
    return Array.from(grid.querySelectorAll('tbody tr')).flatMap((row) =>
      Array.from(row.querySelectorAll<HTMLElement>(':scope > td'))
        .slice(skip)
        .map((cell) => ({
          text: cell.textContent,
          name: cell.getAttribute('aria-label') ?? cell.querySelector('a')?.getAttribute('aria-label') ?? '',
        })),
    );
  });
}

function setup(): ReturnType<typeof renderWithProviders> {
  document.documentElement.className = 'light';
  return renderWithProviders(<ChartGridsSection />);
}

describe('the chart grids section', () => {
  it('shows a group for the heat-map table and one for the small multiples', () => {
    const { container } = setup();
    const headings = Array.from(container.querySelectorAll('section > header > h2')).map((node) => node.textContent);
    expect(headings).toContain('Heat-map table');
    expect(headings).toContain('Small multiples');
    expect(headings.indexOf('Heat-map table')).toBeLessThan(headings.indexOf('Small multiples'));
  });

  it(
    'has no accessibility violation in the light theme',
    async () => {
      const { container } = setup();
      expect(await axe(container)).toHaveNoViolations();
    },
    SECTION_TIMEOUT_MS,
  );

  describe('the heat-map table', () => {
    it('gives every cell an accessible name with its counts', () => {
      const { container } = setup();
      const cells = heatCells(container);
      // Topics 4 x 4, weeks 3 x 10, change 3 x 3, the stale frame 2 x 4
      expect(cells).toHaveLength(16 + 30 + 9 + 8);
      for (const cell of cells) expect(cell.name).toMatch(COUNTED);
    });

    it('prints "3 ans" in a hatched cell, with no percent in its text or its name', () => {
      const { container } = setup();
      const hatched = heatCells(container).filter((cell) => cell.text === '3 ans');
      expect(hatched.length).toBeGreaterThan(0);
      for (const cell of hatched) {
        // A rate cell says its thin count; a change cell says it cannot compare
        expect(cell.name).toMatch(/3 answers, fewer than 4|too few answers to compare, 3 then 20/);
        expect(cell.name).not.toContain('%');
        expect(cell.text).not.toContain('%');
      }
    });

    it('prints "n/a" in a cell with no answers, never "0%"', () => {
      const { container } = setup();
      const unknown = heatCells(container).filter((cell) => cell.text === 'n/a');
      // The topic frame and its stale copy (Analytics on Gemini), and the week without answers
      expect(unknown.length).toBeGreaterThanOrEqual(3);
      for (const cell of unknown) {
        expect(cell.name).toMatch(/no answers|no engine has a rate/i);
        expect(cell.name).not.toMatch(/\b0%/);
        expect(cell.text).not.toMatch(/\b0%/);
      }
    });

    it('keeps a real rate of 0% as it is: Email marketing on AI Mode, 0 of 40 answers', () => {
      const { container } = setup();
      const zero = heatCells(container).filter((cell) => cell.name.includes('0 of 40 answers'));
      expect(zero.length).toBeGreaterThan(0);
      for (const cell of zero) {
        expect(cell.text).toBe('0%');
        expect(cell.name).toMatch(/^Email marketing on AI Mode: 0\.0%/);
      }
    });
  });

  describe('the small multiples', () => {
    it('captions every panel with its latest value and counts', () => {
      const { container } = setup();
      const figures = Array.from(container.querySelectorAll('figure'));
      // Engines 3, topics 4, 180 px 2 and the stale frame 2
      expect(figures).toHaveLength(3 + 4 + 2 + 2);
      for (const figure of figures) {
        const captions = figure.querySelectorAll('figcaption');
        expect(captions).toHaveLength(1);
        expect(captions[0]?.textContent).toMatch(/of \d+ answers/);
      }
    });

    it('draws one chart per panel', () => {
      const { container } = setup();
      for (const figure of Array.from(container.querySelectorAll('figure'))) {
        expect(within(figure).getAllByTestId('echart-canvas')).toHaveLength(1);
      }
    });

    it('reads every panel in one table with a column each, and a gap is "No data"', async () => {
      const { container, user } = setup();
      const views = within(container).getByRole('group', { name: 'Mention rate by engine view' });
      await user.click(within(views).getByRole('button', { name: 'Table' }));
      const table = within(container).getByRole('table', { name: 'Mention rate by engine' });
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual(['Week', 'ChatGPT', 'Gemini', 'AI Mode']);
      expect(within(table).getAllByRole('row')).toHaveLength(12 + 1);
      // AI Mode has no answers in the week of Aug 31
      const aug31 = within(table).getByRole('row', { name: /^Aug 31/ });
      expect(within(aug31).getAllByRole('cell')[2]).toHaveTextContent('No data');
      expect(table).not.toHaveTextContent(/(^|[^0-9.])0%/);
    });
  });
});
