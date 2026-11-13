import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { PromptWeekHeatmap } from './prompt-week-heatmap';
import { promptWeekGrid, promptWeekView, type PromptWeekWords } from './prompt-week-model';
import { topicDescendants } from '../topic-nodes';
import { engineCells, promptRow, type WeekSpec } from '../topic-card-test-kit';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { formatChartDate } from '@/lib/format';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/*
 * The presentational heat map of CH-12: rows are the prompts of one topic, columns are weeks. It reads a view that
 * the model builds with the words it is given, so any screen can render it. It is rendered here with none of the
 * Overview around it.
 */

const CRM = 'crm';
const TREE: NamedTerm[] = [{ termId: CRM, name: 'CRM', parentId: null, path: 'CRM' }];

const W1 = '2026-10-05';
const W2 = '2026-10-12';
const W3 = '2026-10-19';
const W4 = '2026-10-26';

const WORDS: PromptWeekWords = {
  rateTip: {
    value: (ratio) => `${(ratio * 100).toFixed(1)}%`,
    answers: (k, n) => `${String(k)} of ${String(n)} answers`,
    interval: (band) => `${(band.low * 100).toFixed(0)}% to ${(band.high * 100).toFixed(0)}%`,
    prompts: (count) => `${String(count)} prompts`,
    thin: (n) => `${String(n)} answers, fewer than 4`,
    pooled: (weeks) => `pooled over ${String(weeks)} weeks`,
    noAnswers: 'No answers',
  },
  percent: (value) => `${String(Math.round(value * 100))}%`,
  date: (iso) => formatChartDate(iso),
  pooledTitle: (weeks, date) => `${String(weeks)} weeks to ${date}`,
  weekTitle: (date) => `Week of ${date}`,
  share: (percent, answers) => `${percent}, ${String(answers)} answers name a brand`,
  subject: (prompt, title, value) => `${prompt}, ${title}: ${value}`,
};

const week = (weekStart: string, mentioned: readonly [number, number], weeks = 4): WeekSpec => ({
  weekStart,
  prompts: 1,
  mentioned,
  pool: { weeks },
});

const PROMPTS = [
  promptRow(
    'p1',
    'Best CRM for startups',
    [CRM],
    [
      engineCells('chatgpt_web', {
        mentioned: [1, 2],
        series: [week(W1, [2, 8]), week(W2, [0, 0]), week(W3, [2, 3]), week(W4, [5, 8])],
      }),
    ],
  ),
  promptRow(
    'p2',
    'CRM pricing compared',
    [CRM],
    [engineCells('chatgpt_web', { mentioned: [1, 2], series: [week(W3, [1, 8], 2), week(W4, [4, 8], 1)] })],
  ),
];

function view(hrefOf: (promptId: string) => Route | null = () => null) {
  const grid = promptWeekGrid({
    prompts: PROMPTS,
    termId: CRM,
    descendants: topicDescendants(TREE, []),
    code: 'chatgpt_web',
    metric: 'mentioned',
  });
  return promptWeekView(grid, 'mentioned', WORDS, hrefOf);
}

function renderGrid(hrefOf?: (promptId: string) => Route | null) {
  return renderWithProviders(
    <PromptWeekHeatmap grid={view(hrefOf)} caption="Prompt by week" rowHeader="Prompt" density="compact" />,
  );
}

const grid = (): HTMLElement => screen.getByRole('grid');
const cell = (name: RegExp): HTMLElement => within(grid()).getByRole('gridcell', { name });

describe('the grid', () => {
  it('columns are weeks with the Monday date', () => {
    renderGrid();
    expect(
      within(grid())
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Prompt', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26']);
  });

  it('a row per prompt, the highest last value first', () => {
    renderGrid();
    expect(
      within(grid())
        .getAllByRole('rowheader')
        .map((header) => header.getAttribute('aria-label')),
    ).toEqual(['Best CRM for startups', 'CRM pricing compared']);
  });

  it('cell tips say N weeks to date, k of n answers and the percent', () => {
    renderGrid();
    const tip = cell(/^Best CRM for startups, 4 weeks to Oct 26/).getAttribute('aria-label') ?? '';
    expect(tip).toContain('5 of 8 answers');
    expect(tip).toContain('62.5%');
    expect(cell(/^Best CRM for startups, 4 weeks to Oct 26/)).toHaveTextContent('63%');
  });

  it('a point that holds only its own week does not say it is pooled', () => {
    renderGrid();
    const tip = cell(/^CRM pricing compared, Week of Oct 26/).getAttribute('aria-label') ?? '';
    expect(tip).not.toContain('weeks to');
    expect(tip).toContain('4 of 8 answers');
    // A pooled one beside it still says its weeks
    expect(cell(/^CRM pricing compared, 2 weeks to Oct 19/)).toBeInTheDocument();
  });

  it('a thin cell is hatched and says its answers', () => {
    renderGrid();
    const thin = cell(/^Best CRM for startups, 4 weeks to Oct 19/);
    expect(thin).toHaveClass('bg-insufficient');
    expect(thin).toHaveTextContent('3 ans');
    expect(thin.textContent).not.toContain('%');
    expect(thin.getAttribute('aria-label')).toContain('3 answers');
    expect(thin.getAttribute('aria-label')).not.toContain('%');
  });

  it('a missing week says n/a', () => {
    renderGrid();
    // A week the prompt has no point for, and a week with a point and no valid answer
    const absent = cell(/^CRM pricing compared, Week of Oct 5/);
    expect(absent).toHaveTextContent('n/a');
    const none = cell(/^Best CRM for startups, 4 weeks to Oct 12: No answers/);
    expect(none).toHaveTextContent('n/a');
    for (const one of [absent, none]) {
      expect(one.textContent).not.toContain('0%');
      expect(one.getAttribute('aria-label')).not.toContain('0%');
      expect(one).not.toHaveClass('bg-insufficient');
    }
  });

  it('a cell and the prompt text open the prompt when the card gives a link', () => {
    renderGrid((promptId) => `/prompts/${promptId}` as Route);
    const link = within(grid()).getByRole('link', { name: /^Best CRM for startups, 4 weeks to Oct 26/ });
    expect(link).toHaveAttribute('href', '/prompts/p1');
    expect(within(grid()).getByRole('link', { name: 'Best CRM for startups' })).toHaveAttribute('href', '/prompts/p1');
  });

  it('a share of voice tip says the answers it is over, since it has no count of successes', () => {
    const sov = promptRow(
      's1',
      'Share prompt',
      [CRM],
      [
        engineCells('chatgpt_web', {
          mentioned: [1, 2],
          series: [{ weekStart: W4, prompts: 1, mentioned: [5, 8], sov: [3, 6], pool: { weeks: 4 } }],
        }),
      ],
    );
    const shares = promptWeekGrid({
      prompts: [sov],
      termId: CRM,
      descendants: topicDescendants(TREE, []),
      code: 'chatgpt_web',
      metric: 'share_of_voice',
    });
    renderWithProviders(
      <PromptWeekHeatmap
        grid={promptWeekView(shares, 'share_of_voice', WORDS, () => null)}
        caption="Prompt by week"
        rowHeader="Prompt"
        density="compact"
      />,
    );
    const tip = cell(/^Share prompt, 4 weeks to Oct 26/).getAttribute('aria-label') ?? '';
    expect(tip).toContain('50.0%, 6 answers name a brand');
    expect(tip).not.toContain('of 6 answers');
  });

  it('the Table form prints the words of each cell', () => {
    renderWithProviders(
      <PromptWeekHeatmap grid={view()} caption="Prompt by week" rowHeader="Prompt" density="compact" form="table" />,
    );
    expect(screen.getAllByText(/^Best CRM for startups, 4 weeks to Oct 26: 62\.5%/).length).toBeGreaterThan(0);
  });
});

describe('the component', () => {
  it('renders without the Overview provider (presentational)', () => {
    // renderWithProviders gives the message catalog and nothing of the Overview: a hook of the Overview would throw
    expect(() => renderGrid()).not.toThrow();
    expect(grid()).toBeInTheDocument();
  });

  it('axe has no violations in the grid and the Table form', async () => {
    const { container } = renderGrid();
    expect(await axe(container)).toHaveNoViolations();
    const table = renderWithProviders(
      <PromptWeekHeatmap grid={view()} caption="Prompt by week" rowHeader="Prompt" density="compact" form="table" />,
    );
    expect(await axe(table.container)).toHaveNoViolations();
  });

  it('keyboard grid arrows move between cells', async () => {
    const { user } = renderGrid((promptId) => `/prompts/${promptId}` as Route);
    const header = within(grid()).getByRole('rowheader', { name: 'CRM pricing compared' });
    header.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(grid()).getByRole('link', { name: /^CRM pricing compared, Week of Oct 5/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(grid()).getByRole('link', { name: /^CRM pricing compared, 2 weeks to Oct 19/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(within(grid()).getByRole('link', { name: /^Best CRM for startups, 4 weeks to Oct 19/ })).toHaveFocus();
  });
});
