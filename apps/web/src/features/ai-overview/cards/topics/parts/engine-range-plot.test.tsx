import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { EngineRangePlot, EngineRangeTable, type RangeDot, type RangePlotRow } from './engine-range-plot';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const dot = (code: string, name: string, position: number | null, text: string): RangeDot => ({
  code,
  name,
  position,
  text,
});

const ROW: RangePlotRow = {
  id: 'seo',
  label: 'SEO tools',
  href: '/w/p/ai/prompts?inspect=topic:seo' as Route,
  dots: [
    dot('chatgpt_web', 'ChatGPT', 80, '80.0%, 8 of 10 answers, 4 prompts, each counts once'),
    dot('gemini_web', 'Gemini', 41.5, '41.5%, 83 of 200 answers, 4 prompts, each counts once'),
    dot('google_ai_mode', 'Google AI Mode', null, '3 answers'),
  ],
  spreadText: '39 points',
  verdict: 'detectable difference',
  accessibleText:
    'SEO tools: 39 points between ChatGPT and Gemini, detectable difference. ChatGPT 80.0%. Gemini 41.5%. Google AI Mode 3 answers.',
  detail: 'ChatGPT 80%; Gemini 41.5%; Google AI Mode 3 answers',
};

const plot = (rows: readonly RangePlotRow[] = [ROW]) =>
  renderWithProviders(<EngineRangePlot rows={rows} caption="Engine range of SEO topics" />);

const dotsOf = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>('[data-slot="range-dot"]'),
];

describe('EngineRangePlot', () => {
  it('a dot per engine with a rate at its percent on one shared axis', () => {
    const { container } = plot([
      ROW,
      {
        ...ROW,
        id: 'ads',
        label: 'Paid ads',
        dots: [dot('chatgpt_web', 'ChatGPT', 10, '10%'), dot('gemini_web', 'Gemini', 55, '55%')],
      },
    ]);
    const positions = dotsOf(container).map((entry) => entry.style.left);
    // Two engines with a rate on the first row, two on the second, on the same 0 to 100 scale
    expect(positions).toEqual(['80%', '41.5%', '10%', '55%']);
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
  });

  it('a thin engine has no dot and says its answers in text', () => {
    const { container } = plot();
    // ChatGPT and Gemini have a dot, Google AI Mode (3 answers) has none
    expect(dotsOf(container)).toHaveLength(2);
    expect(dotsOf(container).map((entry) => entry.getAttribute('data-engine'))).toEqual(['chatgpt_web', 'gemini_web']);
    const row = container.querySelector('li');
    expect(within(row as HTMLElement).getByText('Google AI Mode: 3 answers')).toBeInTheDocument();
  });

  it('the line spans the lowest to the highest dot', () => {
    const { container } = plot();
    const line = container.querySelector<HTMLElement>('[data-slot="range-line"]');
    expect(line?.style.left).toBe('41.5%');
    expect(line?.style.width).toBe('38.5%');
  });

  it('a row with one dot draws no line', () => {
    const { container } = plot([{ ...ROW, dots: [dot('chatgpt_web', 'ChatGPT', 80, '80%')] }]);
    expect(container.querySelector('[data-slot="range-line"]')).toBeNull();
  });

  it('each row is a list item with the full sentence as its accessible text', () => {
    plot();
    const [item] = screen.getAllByRole('listitem');
    expect(item).toBeDefined();
    expect(screen.getByRole('list', { name: 'Engine range of SEO topics' })).toBeInTheDocument();
    const link = within(item as HTMLElement).getByRole('link', { name: ROW.accessibleText });
    expect(link).toHaveAttribute('href', ROW.href);
  });

  it('a row without a link is still a list item with its sentence', () => {
    const { container } = plot([{ ...ROW, href: undefined }]);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('li')).toHaveTextContent(ROW.accessibleText);
  });

  it('the dots differ by shape as well as colour', () => {
    const { container } = plot([
      { ...ROW, dots: ROW.dots.map((entry, place) => ({ ...entry, position: 20 + place * 20 })) },
    ]);
    const shapes = dotsOf(container).map((entry) => entry.getAttribute('data-shape'));
    expect(new Set(shapes).size).toBe(3);
  });

  it('has no axe violations', async () => {
    const { container } = plot([ROW, { ...ROW, id: 'ads', label: 'Paid ads', href: undefined }]);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('EngineRangeTable', () => {
  const table = () =>
    renderWithProviders(
      <EngineRangeTable
        rows={[ROW]}
        caption="Engine range table"
        labels={{ topic: 'Topic', spread: 'Spread', verdict: 'Reading' }}
      />,
    );

  it('the Table form lists every engine value with counts', () => {
    table();
    const grid = screen.getByRole('table', { name: 'Engine range table' });
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Topic', 'ChatGPT', 'Gemini', 'Google AI Mode', 'Spread', 'Reading']);
    // The first column names the row
    expect(within(grid).getByRole('rowheader')).toHaveTextContent('SEO tools');
    const cells = within(grid)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toEqual([
      '80.0%, 8 of 10 answers, 4 prompts, each counts once',
      '41.5%, 83 of 200 answers, 4 prompts, each counts once',
      '3 answers',
      '39 points',
      'detectable difference',
    ]);
  });

  it('has no axe violations', async () => {
    const { container } = table();
    expect(await axe(container)).toHaveNoViolations();
  });
});
