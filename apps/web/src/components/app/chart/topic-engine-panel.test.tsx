import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { TopicEnginePanel, TopicEnginePanelTable, type EnginePanelRow } from './topic-engine-panel';
import { formatMetricDelta, type MetricDeltaInput } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const WORDS = {
  caption: 'Mention by engine',
  labelHeader: 'Engine',
  valueHeader: 'Mention',
  contextHeader: 'Answers',
  changeHeader: 'Change',
} as const;

const ok = (code: string, label: string, over: Partial<EnginePanelRow> = {}): EnginePanelRow => ({
  code,
  label,
  state: 'ok',
  value: 0.375,
  valueText: '38%',
  contextText: '3 of 8 answers, 4 prompts',
  answers: 8,
  noneText: 'No answers',
  accessibleText: `${label}: 38%, 3 of 8 answers`,
  ...over,
});

const CHATGPT = ok('chatgpt_web', 'ChatGPT');
const GEMINI = ok('gemini_web', 'Gemini', {
  value: 0.25,
  valueText: '25%',
  contextText: '2 of 8 answers, 4 prompts',
  accessibleText: 'Gemini: 25%, 2 of 8 answers',
});
const THIN = ok('google_ai_mode', 'Google AI Mode', {
  state: 'insufficient',
  value: null,
  valueText: '',
  contextText: null,
  answers: 3,
  accessibleText: 'Google AI Mode: too few answers (3), 1 of 3 answers',
});
const NONE = ok('google_ai_mode', 'Google AI Mode', {
  state: 'none',
  value: null,
  valueText: '',
  contextText: null,
  answers: 0,
  accessibleText: 'Google AI Mode: No answers',
});

const bars = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-slot="bar-list-bar"]'));
const rowOf = (name: string): HTMLElement => {
  const item = screen.getByText(name, { selector: '[data-slot="bar-list-label"]' }).closest('li');
  if (item === null) throw new Error(`The row of ${name} is missing`);
  return item;
};

describe('TopicEnginePanel: the engines of a topic as rows', () => {
  it('draws a row per engine with logo, bar, percent and the counts beside it', () => {
    const { container } = renderWithProviders(<TopicEnginePanel {...WORDS} rows={[CHATGPT, GEMINI]} />);
    const list = screen.getByRole('list', { name: 'Mention by engine' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    // The engine's mark is before its name, hidden from assistive technology
    expect(container.querySelectorAll('img[alt=""]')).toHaveLength(2);
    expect(bars(container)).toHaveLength(2);
    // A percent is its length on the scale of 100: 25 percent is a quarter of the track
    expect(bars(container).map((bar) => bar.style.width)).toEqual(['37.5%', '25%']);
    const first = rowOf('ChatGPT');
    expect(first).toHaveTextContent('38%');
    expect(first).toHaveTextContent('3 of 8 answers, 4 prompts');
    // The row is read once, from its words
    expect(within(first).getByText('ChatGPT: 38%, 3 of 8 answers')).toBeInTheDocument();
  });

  it('a row under 4 answers shows the small sample marker and no bar', () => {
    const { container } = renderWithProviders(<TopicEnginePanel {...WORDS} rows={[CHATGPT, THIN]} />);
    expect(bars(container)).toHaveLength(1);
    const row = rowOf('Google AI Mode');
    expect(row).toHaveTextContent('3 answers');
    expect(row.textContent).not.toMatch(/%/);
    expect(within(row).getByText('Google AI Mode: too few answers (3), 1 of 3 answers')).toBeInTheDocument();
  });

  it('a row without answers says so and is never 0', () => {
    const { container } = renderWithProviders(<TopicEnginePanel {...WORDS} rows={[CHATGPT, NONE]} />);
    expect(bars(container)).toHaveLength(1);
    const row = rowOf('Google AI Mode');
    expect(row).toHaveTextContent('No answers');
    expect(row.textContent).not.toMatch(/0%|0 of/);
  });

  it('a row is a link when it has an href, named by engine and value', () => {
    renderWithProviders(
      <TopicEnginePanel
        {...WORDS}
        rows={[{ ...CHATGPT, href: '/ws/p/ai/prompts?inspect=topic:1&itab=prompts&eng=chatgpt_web' as Route }, GEMINI]}
      />,
    );
    const link = screen.getByRole('link', { name: 'ChatGPT: 38%, 3 of 8 answers' });
    expect(link).toHaveAttribute('href', '/ws/p/ai/prompts?inspect=topic:1&itab=prompts&eng=chatgpt_web');
    // A row with no href is no link
    expect(screen.queryByRole('link', { name: /Gemini/ })).toBeNull();
  });

  it('shows the change only when a row has one', () => {
    const input: MetricDeltaInput = { value: 0.05, unit: 'points', polarity: 'higher_is_better', isDetectable: false };
    renderWithProviders(
      <TopicEnginePanel
        {...WORDS}
        rows={[{ ...CHATGPT, delta: { input, test: 'interim', text: formatMetricDelta(input).text } }, GEMINI]}
      />,
    );
    expect(rowOf('ChatGPT')).toHaveTextContent('+5.0 pts');
    expect(rowOf('Gemini').textContent).not.toMatch(/\d pts/);
  });

  it('has a table form and passes the accessibility check', async () => {
    const input: MetricDeltaInput = { value: 0.05, unit: 'points', polarity: 'higher_is_better', isDetectable: true };
    const rows = [
      { ...CHATGPT, delta: { input, test: 'interim' as const, text: formatMetricDelta(input).text } },
      THIN,
    ];
    const list = renderWithProviders(<TopicEnginePanel {...WORDS} rows={rows} />);
    expect(await axe(list.container)).toHaveNoViolations();
    list.unmount();
    const table = renderWithProviders(<TopicEnginePanelTable {...WORDS} rows={rows} />);
    const grid = screen.getByRole('table', { name: 'Mention by engine' });
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Engine', 'Mention', 'Answers', 'Change']);
    // The same words as the list: the value, the counts, the change, and the thin row's answers
    const [, first, second] = within(grid).getAllByRole('row');
    expect(first).toHaveTextContent('ChatGPT38%3 of 8 answers, 4 prompts+5.0 pts');
    expect(second).toHaveTextContent('Google AI Mode3 answers');
    expect(await axe(table.container)).toHaveNoViolations();
  });
});
