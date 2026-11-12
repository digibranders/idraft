import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import {
  BarList,
  BarListTable,
  barListCsv,
  type BarListProps,
  type BarValue,
  type ComparisonRow,
  type DistributionRow,
} from './bar-list';
import { ChartFrame } from './chart-frame';
import { formatMetricDelta, formatPointsDelta, type MetricDeltaInput } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const THIN = (answers: number) => `${String(answers)} answers`;

function value(ratio: number, valueText: string, contextText: string | null = null): BarValue {
  return { kind: 'value', value: ratio, valueText, contextText };
}

function comparisonRow(id: string, label: string, bar: BarValue, extra: Partial<ComparisonRow> = {}): ComparisonRow {
  const words = bar.kind === 'value' ? `${bar.valueText} share of voice` : 'no rate';
  return { id, label, value: bar, own: false, accessibleText: `${label}: ${words}`, ...extra };
}

const ROWS: readonly ComparisonRow[] = [
  comparisonRow('hubspot', 'HubSpot', value(0.33, '33%', '466 of 1,412 answers'), { own: true }),
  comparisonRow('zapier', 'Zapier', value(0.27, '27%', '381 of 1,412 answers')),
  comparisonRow('g2', 'G2', value(0.11, '11%', '155 of 1,412 answers')),
];

const HEADERS = {
  caption: 'Share of voice on ChatGPT',
  labelHeader: 'Brand',
  valueHeader: 'Share of voice',
  contextHeader: 'Answers',
} as const;

type CommonExtra = Partial<
  Pick<
    BarListProps,
    | 'caption'
    | 'labelHeader'
    | 'valueHeader'
    | 'contextHeader'
    | 'changeHeader'
    | 'max'
    | 'limit'
    | 'showAllHref'
    | 'density'
  >
>;

function comparison(rows: readonly ComparisonRow[] = ROWS, extra: CommonExtra = {}): BarListProps {
  return { ...HEADERS, mode: 'comparison', rows, ...extra };
}

function distribution(rows: readonly DistributionRow[]): BarListProps {
  return { ...HEADERS, mode: 'distribution', rows };
}

const bars = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-slot="bar-list-bar"]'));

const widthOf = (bar: HTMLElement): number => Number.parseFloat(bar.style.width);

describe('BarList comparison', () => {
  it('is a list named by its caption with one item per row, read from the accessible text', () => {
    const { container } = renderWithProviders(<BarList {...comparison()} />);
    const list = screen.getByRole('list', { name: 'Share of voice on ChatGPT' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    ROWS.forEach((row, index) => {
      const item = items[index];
      if (item === undefined) throw new Error('Missing item');
      expect(within(item).getByText(row.accessibleText)).toHaveClass('sr-only');
    });
    // Every bar sits inside the hidden visual part, so the row is read once
    expect(bars(container)).toHaveLength(3);
    for (const bar of bars(container)) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('colours the own row chart-1 and its label strong, every other row neutral', () => {
    const { container } = renderWithProviders(<BarList {...comparison()} />);
    const [own, zapier, g2] = bars(container);
    expect(own).toHaveClass('bg-chart-1');
    expect(zapier).toHaveClass('bg-chart-bar-neutral');
    expect(g2).toHaveClass('bg-chart-bar-neutral');
    expect(screen.getByText('HubSpot', { selector: '[data-slot="bar-list-label"]' })).toHaveClass('type-body-strong');
    expect(screen.getByText('Zapier', { selector: '[data-slot="bar-list-label"]' })).toHaveClass('type-body');
    expect(screen.getByText('Zapier', { selector: '[data-slot="bar-list-label"]' })).not.toHaveClass(
      'type-body-strong',
    );
  });

  it('draws every bar on one scale from zero', () => {
    const { container } = renderWithProviders(<BarList {...comparison()} />);
    const widths = bars(container).map(widthOf);
    expect(widths[0]).toBeCloseTo(100);
    expect(widths[1]).toBeCloseTo(81.82, 1);
    expect(widths[2]).toBeCloseTo(33.33, 1);
  });

  it('uses the max it is given and clamps a value above it', () => {
    const half = renderWithProviders(<BarList {...comparison(ROWS, { max: 0.5 })} />);
    expect(bars(half.container).map(widthOf)).toEqual([expect.closeTo(66), expect.closeTo(54), expect.closeTo(22)]);
    half.unmount();
    const clamped = renderWithProviders(<BarList {...comparison(ROWS, { max: 0.2 })} />);
    expect(widthOf(bars(clamped.container)[0] ?? document.body)).toBe(100);
  });

  it('shows the value text and its context on every row, and the value alone when there is no context', () => {
    renderWithProviders(
      <BarList
        {...comparison([...ROWS, comparisonRow('prompts', 'Prompts asked', value(0.05, '23 prompts', null))])}
      />,
    );
    // The value is drawn once for the narrow layout and once beside the bar; the container query picks one
    expect(screen.getAllByText('33%').length).toBeGreaterThan(0);
    expect(screen.getByText('466 of 1,412 answers')).toBeInTheDocument();
    expect(screen.getAllByText('23 prompts').length).toBeGreaterThan(0);
    // Three rows carry a context; the count row draws its value alone
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.querySelectorAll('[data-slot="bar-list-context"]').length)).toEqual([1, 1, 1, 0]);
  });

  it('says "3 answers" for a thin row, with no bar and no percent (R2)', () => {
    const rows = [
      ...ROWS,
      comparisonRow('thin', 'Fieldnote', { kind: 'thin', answers: 3 }, { accessibleText: 'Fieldnote: 3 answers' }),
    ];
    const { container } = renderWithProviders(<BarList {...comparison(rows)} />);
    expect(bars(container)).toHaveLength(3);
    const item = screen.getAllByRole('listitem')[3];
    if (item === undefined) throw new Error('Missing thin row');
    const words = within(item).getAllByText('3 answers');
    expect(words.length).toBeGreaterThan(0);
    for (const text of words) expect(text).toHaveClass('text-foreground-tertiary');
    expect(item.querySelector('[data-slot="bar-list-bar"]')).toBeNull();
    expect(item).not.toHaveTextContent('%');
  });

  it('says why a value is unknown and draws no bar and no zero (R6)', () => {
    const rows = [
      ...ROWS,
      comparisonRow('none', 'Gemini', { kind: 'none' }, { accessibleText: 'Gemini: no data' }),
      comparisonRow(
        'reason',
        'AI Mode',
        { kind: 'none', text: 'Fan-out not exposed by this engine' },
        { accessibleText: 'AI Mode: fan-out not exposed by this engine' },
      ),
    ];
    const { container } = renderWithProviders(<BarList {...comparison(rows)} />);
    expect(bars(container)).toHaveLength(3);
    const [none, reason] = screen.getAllByRole('listitem').slice(3);
    if (none === undefined || reason === undefined) throw new Error('Missing unknown rows');
    expect(within(none).getAllByText('No data').length).toBeGreaterThan(0);
    expect(within(reason).getAllByText('Fan-out not exposed by this engine').length).toBeGreaterThan(0);
    for (const item of [none, reason]) {
      expect(item.querySelector('[data-slot="bar-list-bar"]')).toBeNull();
      expect(item.textContent).not.toMatch(/(^|[^0-9])0%?(\D|$)/);
    }
  });

  it('draws no zero for a thin row either (R6)', () => {
    renderWithProviders(
      <BarList {...comparison([comparisonRow('thin', 'Fieldnote', { kind: 'thin', answers: 3 })], { max: 1 })} />,
    );
    expect(screen.getByRole('listitem').textContent).not.toMatch(/(^|[^0-9])0%?(\D|$)/);
  });

  it('keeps the value text in its own column, in flow, so a long value never overlaps the context', () => {
    const rows = [
      comparisonRow('wide', 'Prompts asked', value(1, '612 prompts asked', '88 prompts'), { badge: <span>Own</span> }),
    ];
    const { container } = renderWithProviders(<BarList {...comparison(rows)} />);
    expect(container.querySelector('.absolute')).toBeNull();
    const column = container.querySelector('[data-slot="bar-list-value"]');
    expect(column).toHaveClass('w-28', 'shrink-0');
    expect(column).toHaveTextContent('612 prompts asked');
    // The bar and its column are siblings, so a full-width bar ends where the column starts
    expect(column?.previousElementSibling?.querySelector('[data-slot="bar-list-bar"]')).not.toBeNull();
  });

  it('truncates a long reason in flow instead of overflowing into the trailing column', () => {
    const reason = 'Fan-out not exposed by this engine, so no rate can be shown for it';
    const rows = [
      ...ROWS,
      comparisonRow(
        'reason',
        'AI Mode',
        { kind: 'none', text: reason },
        { accessibleText: `AI Mode: ${reason}`, badge: <span>Competitor</span> },
      ),
    ];
    renderWithProviders(<BarList {...comparison(rows)} />);
    const item = screen.getAllByRole('listitem')[3];
    if (item === undefined) throw new Error('Missing reason row');
    const shown = within(item).getAllByText(reason);
    expect(shown.length).toBeGreaterThan(0);
    for (const text of shown) {
      if (text.classList.contains('sr-only')) continue;
      const box = text.closest('.truncate');
      expect(box).toHaveClass('min-w-0', 'truncate');
      expect(box).toHaveAttribute('title', reason);
      expect(box?.closest('.absolute')).toBeNull();
    }
    // Assistive technology still reads all of it
    expect(within(item).getByText(`AI Mode: ${reason}`)).toHaveClass('sr-only');
  });

  it('draws the optional icon in the hidden visual part, outside the accessible name', () => {
    const rows = [
      comparisonRow('icon', 'ChatGPT', value(0.4, '40%'), {
        icon: <svg data-testid="engine-logo" />,
        href: '/p/ai/chatgpt' as Route,
      }),
    ];
    renderWithProviders(<BarList {...comparison(rows)} />);
    expect(screen.getByTestId('engine-logo').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'ChatGPT: 40% share of voice' })).toBeInTheDocument();
  });

  it('keeps the order it is given', () => {
    renderWithProviders(<BarList {...comparison([...ROWS].reverse())} />);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent?.split(':')[0])).toEqual([
      'G2',
      'Zapier',
      'HubSpot',
    ]);
  });
});

describe('BarList distribution', () => {
  const rows: readonly DistributionRow[] = [
    {
      id: 'top3',
      label: 'Top 3',
      scale: 'rank-band-2',
      value: value(0.4, '40%', '40 of 100 answers'),
      accessibleText: 'Top 3: 40%',
    },
    {
      id: 'other',
      label: 'Other',
      scale: 'chart-other',
      value: value(0.35, '35%', '35 of 100 answers'),
      accessibleText: 'Other: 35%',
    },
    {
      id: 'few',
      label: 'Fewer than 4 answers',
      scale: 'insufficient',
      value: value(0.25, '25%', '25 of 100 prompts'),
      accessibleText: 'Fewer than 4 answers: 25%',
    },
  ];

  it('keeps the order and draws each row in its scale colour, never chart-1', () => {
    const { container } = renderWithProviders(<BarList {...distribution(rows)} />);
    const [first, second, third] = bars(container);
    expect(first).toHaveClass('bg-rank-band-2');
    expect(second).toHaveClass('bg-chart-other');
    expect(third).toHaveClass('bg-insufficient');
    expect(container.querySelector('.bg-chart-1')).toBeNull();
    expect(container.querySelector('.bg-chart-bar-neutral')).toBeNull();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent?.split(':')[0])).toEqual([
      'Top 3',
      'Other',
      'Fewer than 4 answers',
    ]);
  });

  it('draws a sequential scale row with its bg-seq utility (CH-18)', () => {
    const seq: readonly DistributionRow[] = [
      { id: 'heat', label: 'Heat', scale: 'seq-3', value: value(0.4, '40%'), accessibleText: 'Heat: 40%' },
    ];
    const { container } = renderWithProviders(<BarList {...distribution(seq)} />);
    expect(bars(container)[0]).toHaveClass('bg-seq-3');
  });
});

describe('BarList links and keyboard', () => {
  const linked = [
    comparisonRow('hubspot', 'HubSpot', value(0.33, '33%', '466 of 1,412 answers'), {
      own: true,
      href: '/p/ai?inspect=domain:hubspot.com' as Route,
      tip: '33%, 466 of 1,412 answers',
    }),
    comparisonRow('zapier', 'Zapier', value(0.27, '27%', '381 of 1,412 answers')),
    comparisonRow('g2', 'G2', value(0.11, '11%', '155 of 1,412 answers'), {
      href: '/p/ai?inspect=domain:g2.com' as Route,
    }),
  ];

  it('makes a linked row a link named by its accessible text, and reaches the links in row order', async () => {
    const { user } = renderWithProviders(<BarList {...comparison(linked)} />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/p/ai?inspect=domain:hubspot.com',
      '/p/ai?inspect=domain:g2.com',
    ]);
    const first = screen.getByRole('link', { name: 'HubSpot: 33% share of voice' });
    const second = screen.getByRole('link', { name: 'G2: 11% share of voice' });
    // WCAG 2.5.3: the name starts with the visible label
    expect(first.getAttribute('href')).not.toBeNull();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(second).toHaveFocus();
    // Zapier has no link: nothing in its row takes a tab stop
    expect(screen.getByRole('list').querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(first).toHaveClass('focus-visible:focus-ring');
    expect(second).toHaveClass('focus-visible:focus-ring');
  });

  it('opens a tooltip with the label and the tip when a linked row takes focus', async () => {
    const { user } = renderWithProviders(<BarList {...comparison(linked)} />);
    await user.tab();
    const tip = await screen.findByText('33%, 466 of 1,412 answers', { selector: '[data-slot="tooltip"] span' });
    expect(tip).toBeInTheDocument();
    expect(screen.getByText('HubSpot', { selector: '[data-slot="tooltip"] span' })).toBeInTheDocument();
  });

  it('puts no focusable element inside the hidden visual part', () => {
    const rows = [
      comparisonRow('hubspot', 'HubSpot', value(0.33, '33%', '466 of 1,412 answers'), {
        href: '/x' as Route,
        delta: {
          input: { value: 0.011, unit: 'points', polarity: 'higher_is_better', isDetectable: true },
          test: 'paired',
          text: '+1.1 pts',
        },
      }),
    ];
    const { container } = renderWithProviders(<BarList {...comparison(rows, { changeHeader: 'Change' })} />);
    for (const hidden of container.querySelectorAll('[aria-hidden="true"]')) {
      expect(hidden.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
    }
  });
});

describe('BarList change', () => {
  const detectable: MetricDeltaInput = {
    value: 0.011,
    unit: 'points',
    polarity: 'higher_is_better',
    isDetectable: true,
  };
  const within_: MetricDeltaInput = { value: 0.011, unit: 'points', polarity: 'higher_is_better', isDetectable: false };

  it('colours a detectable change and leaves an undetectable one neutral, with no tab stop', () => {
    const rows = [
      comparisonRow('a', 'Alpha', value(0.3, '30%', '30 of 100 answers'), {
        delta: { input: detectable, test: 'paired', text: formatMetricDelta(detectable).text },
      }),
      comparisonRow('b', 'Beta', value(0.2, '20%', '20 of 100 answers'), {
        delta: { input: within_, test: 'paired', text: formatMetricDelta(within_).text },
      }),
    ];
    const { container } = renderWithProviders(<BarList {...comparison(rows, { changeHeader: 'Change' })} />);
    const [first, second] = screen.getAllByText(formatPointsDelta(0.011));
    expect(first).toHaveClass('text-positive-text');
    expect(second).toHaveClass('text-foreground-secondary');
    expect(second).not.toHaveClass('text-positive-text');
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
  });
});

describe('BarList limit and density', () => {
  const many = Array.from({ length: 18 }, (_, index) =>
    comparisonRow(`row-${String(index)}`, `Domain ${String(index)}`, value(1 - index / 20, '50%', '5 of 10 answers')),
  );

  it('draws 15 rows and links to the rest, while the table and the CSV keep all 18', () => {
    const props = comparison(many, { showAllHref: '/p/ai/sources' as Route });
    const list = renderWithProviders(<BarList {...props} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(15);
    expect(screen.getByRole('link', { name: 'Show all 18' })).toHaveAttribute('href', '/p/ai/sources');
    list.unmount();
    renderWithProviders(<BarListTable {...props} />);
    // The header row and 18 rows
    expect(screen.getAllByRole('row')).toHaveLength(19);
    expect(barListCsv(props, THIN).rows).toHaveLength(18);
  });

  it('draws no Show all link without an address, and never more than 15 rows', () => {
    renderWithProviders(<BarList {...comparison(many, { limit: 40 })} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(15);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('draws 24 px bars at Default and 16 px bars at Compact', () => {
    const normal = renderWithProviders(<BarList {...comparison()} />);
    for (const bar of bars(normal.container)) expect(bar).toHaveClass('h-6');
    normal.unmount();
    const compact = renderWithProviders(<BarList {...comparison(ROWS, { density: 'compact' })} />);
    for (const bar of bars(compact.container)) {
      expect(bar).toHaveClass('h-4');
      expect(bar).not.toHaveClass('h-6');
    }
  });
});

describe('BarList table and CSV', () => {
  const rows = [
    comparisonRow('formula', '=HYPERLINK("x")', value(0.3, '30%', '30 of 100 answers'), {
      delta: {
        input: { value: 0.011, unit: 'points', polarity: 'higher_is_better', isDetectable: true },
        test: 'paired',
        text: '+1.1 pts',
      },
    }),
    comparisonRow('thin', 'Fieldnote', { kind: 'thin', answers: 3 }),
    comparisonRow('none', 'Gemini', { kind: 'none' }),
  ];

  it('is a table with the caption, the headers and one row per bar row', () => {
    renderWithProviders(<BarListTable {...comparison(rows, { changeHeader: 'Change' })} />);
    const table = screen.getByRole('table', { name: 'Share of voice on ChatGPT' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Brand', 'Share of voice', 'Answers', 'Change']);
    const body = within(table).getAllByRole('row').slice(1);
    expect(body).toHaveLength(3);
    expect(within(body[0] ?? table).getByText('30 of 100 answers')).toBeInTheDocument();
    expect(within(body[0] ?? table).getByText('+1.1 pts')).toBeInTheDocument();
    expect(within(body[1] ?? table).getByText('3 answers')).toBeInTheDocument();
    expect(within(body[2] ?? table).getByText('No data')).toBeInTheDocument();
    expect(table).not.toHaveTextContent(/(^|\D)0%/);
  });

  it('writes every text through safeText, a thin row as its words and an unknown row as an empty cell', () => {
    const csv = barListCsv(comparison(rows, { valueHeader: '+Share', changeHeader: 'Change' }), THIN);
    expect(csv.header).toEqual(['Brand', "'+Share", 'Answers', 'Change']);
    expect(csv.rows).toEqual([
      ['\'=HYPERLINK("x")', '30%', '30 of 100 answers', "'+1.1 pts"],
      ['Fieldnote', '3 answers', null, null],
      ['Gemini', null, null, null],
    ]);
  });

  it('writes the context and the value text through safeText too', () => {
    const risky = [comparisonRow('risky', 'Risky', value(0.3, '=1+1', '+SUM(A1)'))];
    expect(barListCsv(comparison(risky), THIN).rows).toEqual([['Risky', "'=1+1", "'+SUM(A1)"]]);
  });

  it('shows a custom reason in the table cell and no zero (R6)', () => {
    const reason = 'Fan-out not exposed by this engine';
    const reasoned = [comparisonRow('reason', 'AI Mode', { kind: 'none', text: reason })];
    renderWithProviders(<BarListTable {...comparison(reasoned)} />);
    const table = screen.getByRole('table', { name: 'Share of voice on ChatGPT' });
    expect(within(table).getByText(reason)).toBeInTheDocument();
    expect(table).not.toHaveTextContent(/(^|\D)0%?(\D|$)/);
    expect(barListCsv(comparison(reasoned), THIN).rows).toEqual([['AI Mode', null, null]]);
  });

  it('leaves the change column out when no row has a change', () => {
    const csv = barListCsv(comparison(ROWS, { changeHeader: 'Change' }), THIN);
    expect(csv.header).toEqual(['Brand', 'Share of voice', 'Answers']);
    expect(csv.rows[0]).toEqual(['HubSpot', '33%', '466 of 1,412 answers']);
  });
});

describe('BarList inside ChartFrame', () => {
  it('is the html body with Patterns, swaps for its table on Table, and offers CSV but no PNG', async () => {
    const props = comparison(ROWS);
    const { user } = renderWithProviders(
      <ChartFrame
        kind="html"
        variant="panel"
        title="Share of voice vs competitors"
        height={180}
        summary="HubSpot leads with 33 percent."
        status="ready"
        patterns
        body={({ patterns }) => (
          <div data-testid="body" data-patterns={String(patterns)}>
            <BarList {...props} />
          </div>
        )}
        table={<BarListTable {...props} />}
        menu={{ fileName: 'share-of-voice', csv: barListCsv(props, THIN) }}
      />,
    );
    expect(screen.getByRole('list', { name: 'Share of voice on ChatGPT' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Patterns' }));
    expect(screen.getByTestId('body')).toHaveAttribute('data-patterns', 'true');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.queryByRole('list', { name: 'Share of voice on ChatGPT' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Share of voice on ChatGPT' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'More actions for Share of voice vs competitors' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Download CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Download PNG' })).toBeNull();
  });
});

describe('BarList accessibility', () => {
  const linkedRows = ROWS.map((row, index) => ({ ...row, href: `/p/ai/${String(index)}` as Route }));
  const distributionRows: readonly DistributionRow[] = [
    {
      id: 'a',
      label: 'Top 3',
      scale: 'rank-band-1',
      value: value(0.5, '50%', '5 of 10 answers'),
      accessibleText: 'Top 3: 50%',
    },
    {
      id: 'b',
      label: 'Not in top 20',
      scale: 'rank-band-none',
      value: { kind: 'thin', answers: 2 },
      accessibleText: 'Not in top 20: 2 answers',
    },
  ];

  it.each(['light', 'dark'])('has no violation for comparison and distribution in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const first = renderWithProviders(<BarList {...comparison(linkedRows, { changeHeader: 'Change' })} />);
      expect(await axe(first.container)).toHaveNoViolations();
      first.unmount();
      const second = renderWithProviders(<BarList {...distribution(distributionRows)} />);
      expect(await axe(second.container)).toHaveNoViolations();
      second.unmount();
      const table = renderWithProviders(<BarListTable {...comparison()} />);
      expect(await axe(table.container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
