import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MetricStrip, type MetricStripGroup } from './metric-strip';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

let stripWidth = 1200;
class StripObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: { width: stripWidth, height: 76 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

const GROUPS: MetricStripGroup[] = [
  {
    id: 'seo',
    items: [
      { id: 'tracked', label: 'Tracked keywords', value: '986' },
      { id: 'volume', label: 'Search volume', value: '48,210', delta: '+4%', context: 'per month, Google Ads' },
      {
        id: 'kd',
        label: 'Average KD',
        value: 'Insufficient data',
        unknown: { kind: 'insufficient' },
        context: '3 of 986 measured',
      },
    ],
  },
  { id: 'cost', items: [{ id: 'cost', label: 'Cost this month', value: '$12.40' }] },
];

/** The grid's column template, set from the measured width. */
const columnsOf = (name: string): string =>
  screen.getByRole('group', { name }).querySelector('dl')?.style.gridTemplateColumns ?? '';

beforeEach(() => {
  stripWidth = 1200;
  vi.stubGlobal('ResizeObserver', StripObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MetricStrip', () => {
  it('is a named group of terms and values, read as label, value, delta and context', async () => {
    const { container } = renderWithProviders(
      <MetricStrip size="md" label="Summary for the keywords" groups={GROUPS} status="ready" />,
    );
    const strip = screen.getByRole('group', { name: 'Summary for the keywords' });
    expect(
      within(strip)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Tracked keywords', 'Search volume', 'Average KD', 'Cost this month']);
    expect(within(strip).getAllByRole('definition')[1]).toHaveTextContent('48,210+4%per month, Google Ads');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('draws a meter under the value of an item that has one, and none while loading', () => {
    const withMeter: MetricStripGroup[] = [
      {
        id: 'budget',
        items: [{ id: 'budget', label: 'Budget', value: '64% of $2,000.00', meter: <span data-testid="meter" /> }],
      },
    ];
    const { unmount } = renderWithProviders(
      <MetricStrip size="md" label="Summary" groups={withMeter} status="ready" />,
    );
    expect(within(screen.getByRole('definition')).getByTestId('meter')).toBeInTheDocument();
    unmount();
    renderWithProviders(<MetricStrip size="md" label="Summary" groups={withMeter} status="loading" />);
    expect(screen.queryByTestId('meter')).toBeNull();
  });

  it('describes an item with the tooltip text that carries its counts, and draws none while loading', () => {
    const tipped: MetricStripGroup[] = [
      { id: 'ai', items: [{ id: 'mention', label: 'Mention rate', value: '50%', tip: 'Mentioned: 4 of 8 answers' }] },
    ];
    const { unmount } = renderWithProviders(<MetricStrip size="md" label="Summary" groups={tipped} status="ready" />);
    expect(screen.getByRole('definition')).toHaveAccessibleDescription('Mentioned: 4 of 8 answers');
    unmount();
    renderWithProviders(<MetricStrip size="md" label="Summary" groups={tipped} status="loading" />);
    expect(screen.getByRole('definition')).not.toHaveAccessibleDescription();
  });

  it('gives an item with a tooltip a tab stop that opens it, wraps its context, and leaves other items alone', async () => {
    const mixed: MetricStripGroup[] = [
      {
        id: 'ai',
        items: [
          { id: 'plain', label: 'Prompts', value: '3', context: 'across 1 topic' },
          {
            id: 'mention',
            label: 'Mention rate',
            value: '50%',
            context: 'Cited 25% and Share of voice 50%',
            tip: 'Mentioned: 4 of 8 answers',
          },
        ],
      },
    ];
    const { container, user } = renderWithProviders(
      <MetricStrip size="md" label="Summary" groups={mixed} status="ready" />,
    );
    const [plain, tipped] = screen.getAllByRole('definition');
    expect(plain).not.toHaveAttribute('tabindex');
    expect(tipped).toHaveAttribute('tabindex', '0');
    await user.tab();
    expect(tipped).toHaveFocus();
    expect(
      await screen.findByText('Mentioned: 4 of 8 answers', { selector: '[data-slot="tooltip"] span' }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    // A tipped item shows its whole context line (it wraps), where the plain one truncates
    const context = (cell: HTMLElement | undefined, text: string): HTMLElement =>
      within(cell as HTMLElement).getByText(text);
    expect(context(tipped, 'Cited 25% and Share of voice 50%')).not.toHaveAttribute('data-truncate');
    expect(context(plain, 'across 1 topic')).toHaveAttribute('data-truncate');
  });

  it('gives an inline chip with a tooltip a tab stop that opens it and describes it, and leaves the others alone', async () => {
    const mixed: MetricStripGroup[] = [
      {
        id: 'ai',
        items: [
          { id: 'plain', label: 'Prompts', value: '3', context: 'across 1 topic' },
          { id: 'mention', label: 'ChatGPT', value: '50%', context: 'Cited 25%', tip: 'Mentioned: 4 of 8 answers' },
        ],
      },
    ];
    const { container, user } = renderWithProviders(
      <MetricStrip size="inline" label="Summary" groups={mixed} status="ready" />,
    );
    const [plain, tipped] = screen.getAllByRole('definition');
    expect(plain).not.toHaveAttribute('tabindex');
    expect(tipped).toHaveAttribute('tabindex', '0');
    expect(tipped).toHaveAccessibleDescription('Mentioned: 4 of 8 answers');
    // The tooltip carries the counts, so the context is not read a second time
    expect(tipped).not.toHaveTextContent('Cited 25%');
    expect(plain).toHaveTextContent('3across 1 topic');
    await user.tab();
    expect(tipped).toHaveFocus();
    expect(
      await screen.findByText('Mentioned: 4 of 8 answers', { selector: '[data-slot="tooltip"] span' }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('draws no tab stop on an inline chip while it loads, and hatches an insufficient value', () => {
    const tipped: MetricStripGroup[] = [
      {
        id: 'ai',
        items: [
          {
            id: 'mention',
            label: 'Gemini',
            value: '2 answers',
            unknown: { kind: 'insufficient' },
            tip: 'Mentioned: 1 of 2 answers',
          },
        ],
      },
    ];
    const { unmount } = renderWithProviders(
      <MetricStrip size="inline" label="Summary" groups={tipped} status="ready" />,
    );
    expect(screen.getByText('2 answers')).toHaveClass('bg-insufficient');
    unmount();
    renderWithProviders(<MetricStrip size="inline" label="Summary" groups={tipped} status="loading" />);
    expect(screen.getByRole('definition')).not.toHaveAttribute('tabindex');
  });

  it('wraps inline chips onto more rows, unless the toolbar asks for one line', () => {
    const chips: MetricStripGroup[] = [{ id: 'ai', items: [{ id: 'a', label: 'Prompts', value: '3' }] }];
    const { unmount } = renderWithProviders(
      <MetricStrip size="inline" label="Summary" groups={chips} status="ready" />,
    );
    expect(screen.getByRole('group', { name: 'Summary' }).querySelector('dl')).toHaveClass('flex-wrap');
    unmount();
    renderWithProviders(<MetricStrip size="inline" nowrap label="Summary" groups={chips} status="ready" />);
    const row = screen.getByRole('group', { name: 'Summary' }).querySelector('dl');
    expect(row).toHaveClass('flex-nowrap');
    expect(row).not.toHaveClass('flex-wrap');
  });

  it('keeps one row while every cell gets 140 px', () => {
    renderWithProviders(<MetricStrip size="md" label="Summary" groups={GROUPS} status="ready" />);
    expect(columnsOf('Summary')).toBe('repeat(4, minmax(0, 1fr))');
  });

  it('wraps six items into two rows of three when the cells would be narrower', () => {
    stripWidth = 600;
    const six: MetricStripGroup[] = [
      {
        id: 'seo',
        items: Array.from({ length: 6 }, (_, index) => ({
          id: `m${String(index)}`,
          label: `Metric ${String(index)}`,
          value: '1',
        })),
      },
    ];
    renderWithProviders(<MetricStrip size="md" label="Six" groups={six} status="ready" />);
    expect(columnsOf('Six')).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('draws the inspector grid in two columns for four items, and marks a refetch busy', () => {
    renderWithProviders(<MetricStrip size="sm" label="Summary" groups={GROUPS} status="refetching" />);
    expect(columnsOf('Summary')).toBe('repeat(2, minmax(0, 1fr))');
    expect(screen.getByRole('group', { name: 'Summary' })).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps the labels and draws no values while loading', () => {
    renderWithProviders(<MetricStrip size="md" label="Summary" groups={GROUPS} status="loading" />);
    expect(screen.getByText('Search volume')).toBeInTheDocument();
    expect(screen.queryByText('48,210')).toBeNull();
  });
});
