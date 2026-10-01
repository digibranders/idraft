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
