import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TopicTrellis,
  TrellisTable,
  trellisCsv,
  type TrellisCell,
  type TrellisRow,
  type TrellisWords,
} from './topic-trellis';
import type { SmallMultiplePanel } from '@/components/app/chart/small-multiples';
import type { LegendItem } from '@/components/app/chart/chart-legend';
import type { RateBandPoint } from '@/lib/charts/rate-band-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// Names stand in for colours: a test reads which value went where, not how it looks
const TOKENS: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Inter',
  other: '#other',
  reference: '#reference',
  grid: '#grid',
  band: '#band',
  rankBandNone: '#none',
  surfaceElevated: '#elevated',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
};

// The options each canvas was given, by the id of its first series; jsdom has no canvas
interface Drawn {
  option: Record<string, unknown>;
  group: string | undefined;
  height: number;
}
const built = vi.hoisted(() => ({ canvases: new Map<string, unknown>() }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({
    option,
    height,
    group,
  }: {
    option: (tokens: ChartTokens) => Record<string, unknown>;
    height: number;
    group?: string;
  }) => {
    const drawn = option(TOKENS);
    const first = (drawn.series as { id: string }[])[0];
    if (first !== undefined) built.canvases.set(first.id, { option: drawn, group, height });
    return <div data-testid="echart-canvas" data-group={group} />;
  },
}));

const drawnOf = (id: string): Drawn => {
  const drawn = built.canvases.get(id) as Drawn | undefined;
  if (drawn === undefined) throw new Error(`No canvas was drawn for ${id}`);
  return drawn;
};
const axisOf = (id: string, name: 'xAxis' | 'yAxis'): { max?: number; axisLabel?: { show?: boolean } } =>
  drawnOf(id).option[name] as { max?: number; axisLabel?: { show?: boolean } };

beforeEach(() => {
  built.canvases.clear();
});

const WEEKS = ['Oct 19', 'Oct 26', 'Nov 2', 'Nov 9'];

const point = (value: number, tip: string): RateBandPoint => ({
  value,
  band: { low: value - 0.04, high: value + 0.04 },
  thin: false,
  tip,
});

const ENGINES = [
  { code: 'chatgpt_web', label: 'ChatGPT', role: { kind: 'brand' } },
  { code: 'gemini_web', label: 'Gemini', role: { kind: 'palette', index: 2 } },
  { code: 'google_ai_mode', label: 'AI Mode', role: { kind: 'palette', index: 3 } },
] as const;

/** A rate over 50 answers, as the tooltip writes it: "20%, 10 of 50 answers". */
const wordsOf = (value: number): string =>
  `${String(Math.round(value * 100))}%, ${String(Math.round(value * 50))} of 50 answers`;

function cellOf(
  topic: string,
  engine: (typeof ENGINES)[number],
  values: readonly (number | null)[],
  series = true,
): TrellisCell {
  const panel: SmallMultiplePanel = {
    id: `${topic}:${engine.code}`,
    name: `${topic}, ${engine.label}`,
    role: engine.role,
    points: values.map((value) => (value === null ? null : point(value, wordsOf(value)))),
    cellText: values.map((value) => (value === null ? null : wordsOf(value))),
  };
  return { panel, column: engine.code, caption: engine.label, hasSeries: series };
}

/** Two topics on three engines. AI Mode has no series for Email. */
const ROWS: readonly TrellisRow[] = [
  {
    id: 'seo',
    label: 'SEO tools',
    meta: '12 prompts',
    group: 'seo',
    cells: ENGINES.map((engine) => cellOf('SEO tools', engine, [0.2, 0.3, null, 0.4])),
  },
  {
    id: 'email',
    label: 'Email',
    meta: '8 prompts',
    group: 'email',
    cells: ENGINES.map((engine) =>
      engine.code === 'google_ai_mode'
        ? cellOf('Email', engine, [null, null, null, null], false)
        : cellOf('Email', engine, [0.5, 0.6, 0.6, 0.62]),
    ),
  },
];

const WORDS: TrellisWords = {
  noWeekly: 'No weekly data',
  noValue: 'No data',
  latest: (category, text) => `${category}: ${text}`,
};
const NO_HIDDEN: ReadonlySet<string> = new Set();
const TITLES = WEEKS.map((week) => `Week of ${week}`);
const CEILING = 0.7;

const LEGEND_ITEMS: readonly Omit<LegendItem, 'pressed'>[] = ENGINES.map((engine) => ({
  id: engine.code,
  name: engine.label,
  role: engine.role,
}));

function Harness(): ReactElement {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      <TopicTrellis
        rows={ROWS}
        categories={WEEKS}
        titles={TITLES}
        ceiling={CEILING}
        hidden={hidden}
        words={WORDS}
        legend={{
          title: 'Topic trends',
          items: LEGEND_ITEMS.map((item) => ({ ...item, pressed: !hidden.has(item.id) })),
          onToggle: (id) => {
            setHidden((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          },
        }}
      />
      <TrellisTable
        rows={ROWS}
        categories={WEEKS}
        categoryHeader="Week"
        caption="Topic trends table"
        hidden={hidden}
        words={WORDS}
      />
    </>
  );
}

const renderTrellis = () =>
  renderWithProviders(
    <TopicTrellis rows={ROWS} categories={WEEKS} titles={TITLES} ceiling={CEILING} hidden={NO_HIDDEN} words={WORDS} />,
  );

const figureOf = (name: string): HTMLElement => {
  const figure = screen.getByRole('img', { name }).closest('figure');
  if (figure === null) throw new Error(`No figure for ${name}`);
  return figure;
};

describe('TopicTrellis', () => {
  it('renders a panel per topic and engine', async () => {
    renderTrellis();
    // Five charts: the sixth panel has no series and says so in text
    expect(await screen.findAllByTestId('echart-canvas')).toHaveLength(5);
    expect(screen.getAllByRole('img')).toHaveLength(6);
    for (const row of ROWS)
      for (const cell of row.cells) expect(screen.getByRole('img', { name: cell.panel.name })).toBeInTheDocument();
  });

  it('rows are topics and columns are engines', async () => {
    const { container } = renderTrellis();
    await screen.findAllByTestId('echart-canvas');
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['SEO tools', 'Email']);
    const rows = Array.from(container.querySelectorAll('[data-slot="trellis-row"]'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Array.from(row.querySelectorAll('figcaption .type-label')).map((caption) => caption.textContent)).toEqual([
        'ChatGPT',
        'Gemini',
        'AI Mode',
      ]);
      // Three columns from the container's `@xl` width, one below it
      expect(row.querySelector('[class*="@xl:grid-cols-3"]')).not.toBeNull();
    }
  });

  it('panels of one row share a group, rows differ', async () => {
    renderTrellis();
    await screen.findAllByTestId('echart-canvas');
    const seo = ENGINES.map((engine) => drawnOf(`SEO tools:${engine.code}`).group);
    const email = ['chatgpt_web', 'gemini_web'].map((code) => drawnOf(`Email:${code}`).group);
    expect(new Set(seo).size).toBe(1);
    expect(new Set(email).size).toBe(1);
    expect(seo[0]).toBeDefined();
    expect(seo[0]).not.toBe(email[0]);
  });

  it('x labels only on the last row', async () => {
    renderTrellis();
    await screen.findAllByTestId('echart-canvas');
    for (const engine of ENGINES) expect(axisOf(`SEO tools:${engine.code}`, 'xAxis').axisLabel?.show).toBe(false);
    for (const code of ['chatgpt_web', 'gemini_web'])
      expect(axisOf(`Email:${code}`, 'xAxis').axisLabel?.show).not.toBe(false);
    // The last row is taller by the room its labels take, so the plots stay equal
    expect(drawnOf('Email:chatgpt_web').height).toBeGreaterThan(drawnOf('SEO tools:chatgpt_web').height);
    expect(drawnOf('SEO tools:chatgpt_web').height).toBe(140);
  });

  it('every panel has the one ceiling it is given', async () => {
    renderTrellis();
    await screen.findAllByTestId('echart-canvas');
    for (const id of ['SEO tools:chatgpt_web', 'SEO tools:google_ai_mode', 'Email:gemini_web']) {
      expect(axisOf(id, 'yAxis').max).toBe(CEILING);
    }
  });

  it('a panel without a series says no weekly data', async () => {
    renderTrellis();
    await screen.findAllByTestId('echart-canvas');
    const figure = figureOf('Email, AI Mode');
    expect(within(figure).getAllByText('No weekly data').length).toBeGreaterThan(0);
    expect(within(figure).queryByTestId('echart-canvas')).not.toBeInTheDocument();
    // A panel that has a series names its latest week with its words
    expect(within(figureOf('Email, ChatGPT')).getByText('Nov 9: 62%, 31 of 50 answers')).toBeInTheDocument();
    expect(within(figureOf('SEO tools, ChatGPT')).getByText('Nov 9: 40%, 20 of 50 answers')).toBeInTheDocument();
  });

  it('the legend toggles an engine column', async () => {
    const { user } = renderWithProviders(<Harness />);
    await screen.findAllByTestId('echart-canvas');
    const legend = screen.getByRole('list', { name: 'Series in Topic trends' });
    const gemini = within(legend).getByRole('button', { name: 'Gemini' });
    expect(gemini).toHaveAttribute('aria-pressed', 'true');
    await user.click(gemini);
    expect(within(legend).getByRole('button', { name: 'Gemini' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'SEO tools, Gemini' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('img', { name: 'Email, Gemini' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'SEO tools, ChatGPT' })).toBeInTheDocument();
    // Two columns are left
    expect(document.querySelector('[class*="@xl:grid-cols-2"]')).not.toBeNull();
    // The table loses the column too
    const grid = screen.getByRole('table');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).not.toContain('SEO tools, Gemini');
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<Harness />);
    await screen.findAllByTestId('echart-canvas');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('TrellisTable', () => {
  it('the Table form has a column per panel with k of n answers', () => {
    renderWithProviders(
      <TrellisTable
        rows={ROWS}
        categories={WEEKS}
        categoryHeader="Week"
        caption="Topic trends table"
        hidden={NO_HIDDEN}
        words={WORDS}
      />,
    );
    const grid = screen.getByRole('table', { name: 'Topic trends table' });
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Week',
      'SEO tools, ChatGPT',
      'SEO tools, Gemini',
      'SEO tools, AI Mode',
      'Email, ChatGPT',
      'Email, Gemini',
      'Email, AI Mode',
    ]);
    const first = within(grid).getByRole('row', { name: /^Oct 19/ });
    expect(first).toHaveTextContent('20%, 10 of 50 answers');
    expect(first).toHaveTextContent('50%, 25 of 50 answers');
    // A gap is words, never 0
    const third = within(grid).getByRole('row', { name: /^Nov 2/ });
    expect(third).toHaveTextContent('No data');
    expect(within(grid).getAllByRole('row')).toHaveLength(1 + WEEKS.length);
  });
});

describe('trellisCsv', () => {
  it('keeps every panel, the hidden ones too, with the words of the table', () => {
    const csv = trellisCsv({ rows: ROWS, categories: WEEKS, categoryHeader: 'Week', failedText: 'Failed' });
    expect(csv.header).toEqual([
      'Week',
      'SEO tools, ChatGPT',
      'SEO tools, Gemini',
      'SEO tools, AI Mode',
      'Email, ChatGPT',
      'Email, Gemini',
      'Email, AI Mode',
    ]);
    expect(csv.rows[0]?.[1]).toBe('20%, 10 of 50 answers');
    // A gap and a panel without a series are empty cells, never 0
    expect(csv.rows[2]?.[1]).toBeNull();
    expect(csv.rows[0]?.[6]).toBeNull();
    expect(csv.rows.flat()).not.toContain(0);
  });
});
