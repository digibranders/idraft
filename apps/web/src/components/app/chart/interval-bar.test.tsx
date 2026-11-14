import type { Route } from 'next';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChartFrame } from './chart-frame';
import {
  IntervalBar,
  IntervalBarTable,
  changeDomain,
  intervalBarCsv,
  trackPercent,
  type ChangeDomain,
  type DivergingRow,
  type DumbbellRow,
  type IntervalBarProps,
  type IntervalCsvWords,
  type IntervalValue,
  type PointsDeltaInput,
} from './interval-bar';
import { formatMetricDelta, type MetricDeltaInput } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const WORDS: IntervalCsvWords = {
  change: 'Change',
  interval: '95% interval',
  previous: 'Previous',
  current: 'Current',
  thin: 'Too few answers to compare',
  noValue: 'No data',
};

const change = (
  value: number | null,
  isDetectable: boolean | null,
  extra: Partial<Omit<MetricDeltaInput, 'unit'>> = {},
): PointsDeltaInput => ({ value, unit: 'points', polarity: 'higher_is_better', isDetectable, ...extra });

function compare(
  estimate: number,
  low: number,
  high: number,
  input: PointsDeltaInput,
  intervalText = '+9 to +77 pts',
): IntervalValue {
  return {
    kind: 'compare',
    interval: { estimate, low, high },
    change: input,
    test: 'interim',
    changeText: formatMetricDelta(input).text,
    intervalText,
  };
}

function diverging(id: string, label: string, value: IntervalValue, extra: Partial<DivergingRow> = {}): DivergingRow {
  return { id, label, value, accessibleText: `${label}: change`, ...extra };
}

function dumbbell(id: string, label: string, value: IntervalValue, extra: Partial<DumbbellRow> = {}): DumbbellRow {
  return {
    id,
    label,
    value,
    previous: 0.25,
    current: 0.4,
    previousText: '25.0%, 2 of 8',
    currentText: '40.0%, 6 of 15',
    color: 'chart-2',
    accessibleText: `${label}: change`,
    ...extra,
  };
}

const DOMAIN: ChangeDomain = [-0.8, 0.8];

const UP = change(0.5, true);
const DOWN = change(-0.31, true);

function divergingProps(
  rows: readonly DivergingRow[],
  extra: Partial<Extract<IntervalBarProps, { form: 'diverging' }>> = {},
): IntervalBarProps {
  return { form: 'diverging', caption: 'Prompt movers', labelHeader: 'Prompt', rows, domain: DOMAIN, ...extra };
}

function dumbbellProps(
  rows: readonly DumbbellRow[],
  extra: Partial<Extract<IntervalBarProps, { form: 'dumbbell' }>> = {},
): IntervalBarProps {
  return {
    form: 'dumbbell',
    caption: 'Mention rate by engine',
    labelHeader: 'Engine',
    rows,
    rateDomain: [0, 0.5],
    changeDomain: [-0.2, 0.2],
    ...extra,
  };
}

const MOVERS: readonly DivergingRow[] = [
  diverging('up', 'best crm for startups, ChatGPT', compare(0.5, 0.09, 0.77, UP), {
    accessibleText: 'best crm for startups, ChatGPT: +50 pts, 95% interval +9 to +77 pts, detectable',
  }),
  diverging('down', 'crm pricing, Gemini', compare(-0.31, -0.44, -0.1, DOWN, '-44 to -10 pts')),
  diverging('flat', 'crm reviews, Perplexity', compare(0.04, -0.03, 0.11, change(0.04, false), '-3 to +11 pts')),
];

const items = (): HTMLElement[] => screen.getAllByRole('listitem');
const slot = (root: ParentNode, name: string): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`[data-slot="${name}"]`));
const only = (root: ParentNode, name: string): HTMLElement => {
  const found = slot(root, name);
  if (found.length !== 1 || found[0] === undefined)
    throw new Error(`Expected one ${name}, found ${String(found.length)}`);
  return found[0];
};
const left = (node: HTMLElement): number => Number.parseFloat(node.style.left);
const width = (node: HTMLElement): number => Number.parseFloat(node.style.width);

const ZERO = /(^|[^0-9])0%?(\D|$)/;

describe('trackPercent', () => {
  it('places a value on its domain, clamped to the track', () => {
    const domain: ChangeDomain = [-0.6, 0.6];
    expect(trackPercent(0, domain)).toBeCloseTo(50);
    expect(trackPercent(0.3, domain)).toBeCloseTo(75);
    expect(trackPercent(-0.6, domain)).toBeCloseTo(0);
    expect(trackPercent(0.9, domain)).toBe(100);
    expect(trackPercent(-0.9, domain)).toBe(0);
  });

  it('gives 0 for a domain with no width instead of NaN', () => {
    expect(trackPercent(0.2, [0.1, 0.1])).toBe(0);
  });
});

describe('changeDomain', () => {
  it('is symmetric around 0, up to the next tenth above the largest bound', () => {
    expect(
      changeDomain([
        { estimate: 0.5, low: 0.09, high: 0.77 },
        { estimate: -0.2, low: -0.31, high: 0.1 },
      ]),
    ).toEqual([-0.8, 0.8]);
    expect(changeDomain([{ estimate: -0.4, low: -0.5, high: -0.3 }])).toEqual([-0.5, 0.5]);
  });

  it('is at least 0.1 either way, also for no rows', () => {
    expect(changeDomain([{ estimate: 0.01, low: -0.02, high: 0.02 }])).toEqual([-0.1, 0.1]);
    expect(changeDomain([])).toEqual([-0.1, 0.1]);
  });

  it('ignores a bound that is not a number', () => {
    expect(changeDomain([{ estimate: Number.NaN, low: Number.NaN, high: 0.25 }])).toEqual([-0.3, 0.3]);
  });
});

describe('IntervalBar structure', () => {
  it('is one list named by the caption, one item per row, each read once from its accessible text', () => {
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(MOVERS)} />);
    expect(screen.getByRole('list', { name: 'Prompt movers' })).toBeInTheDocument();
    expect(items()).toHaveLength(3);
    expect(items()[0]?.querySelector('.sr-only')?.textContent).toBe(
      'best crm for startups, ChatGPT: +50 pts, 95% interval +9 to +77 pts, detectable',
    );
    for (const node of [...slot(container, 'interval-bar'), ...slot(container, 'interval-whisker')]) {
      expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('hides the row icon from assistive technology', () => {
    const rows = [diverging('a', 'ChatGPT', compare(0.5, 0.09, 0.77, UP), { icon: <svg data-testid="logo" /> })];
    renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    expect(screen.getByTestId('logo').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the order it is given', () => {
    renderWithProviders(<IntervalBar {...divergingProps([...MOVERS].reverse())} />);
    expect(items().map((item) => item.querySelector('.sr-only')?.textContent?.split(':')[0])).toEqual([
      'crm reviews, Perplexity',
      'crm pricing, Gemini',
      'best crm for startups, ChatGPT',
    ]);
  });
});

describe('IntervalBar diverging geometry', () => {
  it('draws a bar from 0 to the estimate on a symmetric domain', () => {
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(MOVERS)} />);
    const [up, down] = slot(container, 'interval-bar');
    if (up === undefined || down === undefined) throw new Error('Missing bars');
    // +0.5 on [-0.8, 0.8]: from the zero line at 50% to 81.25%
    expect(left(up)).toBeCloseTo(50);
    expect(width(up)).toBeCloseTo(31.25);
    // -0.31: ends at the zero line
    expect(left(down) + width(down)).toBeCloseTo(50);
    expect(width(down)).toBeCloseTo(19.375);
  });

  it('draws the whisker from the low to the high of the interval and a zero line at 50%', () => {
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(MOVERS.slice(0, 1))} />);
    const whisker = only(container, 'interval-whisker');
    expect(left(whisker)).toBeCloseTo(trackPercent(0.09, DOMAIN));
    expect(left(whisker) + width(whisker)).toBeCloseTo(trackPercent(0.77, DOMAIN));
    expect(whisker).toHaveClass('bg-foreground-tertiary', 'h-px');
    const caps = slot(container, 'interval-cap');
    expect(caps.map(left)).toEqual([trackPercent(0.09, DOMAIN), trackPercent(0.77, DOMAIN)]);
    const zero = only(container, 'interval-zero');
    expect(left(zero)).toBeCloseTo(50);
    expect(zero).toHaveClass('bg-border-strong', 'w-px');
  });

  it('draws a zero line in every row, so the rows read as one', () => {
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(MOVERS)} />);
    expect(slot(container, 'interval-zero')).toHaveLength(3);
  });

  it('draws no NaN position when the domain has no width', () => {
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(MOVERS, { domain: [0, 0] })} />);
    for (const bar of slot(container, 'interval-bar')) expect(Number.isNaN(left(bar))).toBe(false);
  });

  it('puts the zero line and the bars where an asymmetric domain says: zero at 20% on [-0.2, 0.8]', () => {
    const rows = [
      diverging('up', 'Up', compare(0.5, 0.3, 0.7, UP)),
      diverging('down', 'Down', compare(-0.1, -0.15, -0.05, DOWN)),
    ];
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(rows, { domain: [-0.2, 0.8] })} />);
    for (const zero of slot(container, 'interval-zero')) expect(left(zero)).toBeCloseTo(20);
    const [up, down] = slot(container, 'interval-bar');
    if (up === undefined || down === undefined) throw new Error('Missing bars');
    expect(left(up)).toBeCloseTo(20);
    expect(width(up)).toBeCloseTo(50);
    expect(left(down)).toBeCloseTo(10);
    expect(width(down)).toBeCloseTo(10);
  });

  it('clamps an estimate and an interval beyond the domain to the track edge', () => {
    const rows = [diverging('a', 'Row', compare(0.9, 0.5, 1.2, UP))];
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    const bar = only(container, 'interval-bar');
    expect(left(bar) + width(bar)).toBeCloseTo(100);
    const whisker = only(container, 'interval-whisker');
    expect(left(whisker) + width(whisker)).toBeCloseTo(100);
    expect(slot(container, 'interval-cap').map(left)).toEqual([trackPercent(0.5, DOMAIN), 100]);
  });

  it('draws a bar of no width at the zero line for an estimate of 0', () => {
    const rows = [diverging('a', 'Row', compare(0, -0.1, 0.1, change(0, false)))];
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    const bar = only(container, 'interval-bar');
    expect(left(bar)).toBeCloseTo(50);
    expect(width(bar)).toBe(0);
  });

  it('draws the whisker across the zero line for an interval that crosses 0', () => {
    const rows = [diverging('a', 'Row', compare(0.04, -0.31, 0.1, change(0.04, false)))];
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    const whisker = only(container, 'interval-whisker');
    const zero = left(only(container, 'interval-zero'));
    expect(left(whisker)).toBeCloseTo(trackPercent(-0.31, DOMAIN));
    expect(left(whisker)).toBeLessThan(zero);
    expect(left(whisker) + width(whisker)).toBeGreaterThan(zero);
    expect(left(whisker) + width(whisker)).toBeCloseTo(trackPercent(0.1, DOMAIN));
  });

  it('draws the same whisker when a caller swaps low and high, never a negative width', () => {
    const rows = [diverging('a', 'Row', compare(0.5, 0.77, 0.09, UP))];
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    const whisker = only(container, 'interval-whisker');
    expect(left(whisker)).toBeCloseTo(trackPercent(0.09, DOMAIN));
    expect(width(whisker)).toBeCloseTo(trackPercent(0.77, DOMAIN) - trackPercent(0.09, DOMAIN));
  });

  it('gives every track a width of its own below 448 px, so it cannot collapse in a row beside the delta', () => {
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(MOVERS)} />);
    const bands = slot(container, 'interval-band');
    expect(bands).toHaveLength(3);
    for (const band of bands) expect(band.parentElement).toHaveClass('w-full', '@md:w-auto', '@md:flex-1');
  });
});

describe('IntervalBar colour only for a detectable change (R5)', () => {
  const fillOf = (input: PointsDeltaInput, estimate = input.value ?? 0): HTMLElement => {
    const rows = [diverging('a', 'Row', compare(estimate, estimate - 0.1, estimate + 0.1, input))];
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    return only(container, 'interval-bar');
  };

  it('fills a detectable rise with positive-solid and a detectable fall with negative-solid', () => {
    expect(fillOf(UP)).toHaveClass('bg-positive-solid');
  });

  it('fills a detectable fall with negative-solid', () => {
    expect(fillOf(DOWN)).toHaveClass('bg-negative-solid');
  });

  it('keeps a change inside normal variation neutral, whatever its sign or size', () => {
    expect(fillOf(change(0.5, false))).toHaveClass('bg-chart-reference');
    expect(fillOf(change(0.5, false))).not.toHaveClass('bg-positive-solid');
    expect(fillOf(change(-0.31, false))).toHaveClass('bg-chart-reference');
    expect(fillOf(change(-0.31, false))).not.toHaveClass('bg-negative-solid');
  });

  it('keeps a change nobody tested neutral', () => {
    expect(fillOf(change(0.5, null))).toHaveClass('bg-chart-reference');
    expect(fillOf(change(-0.31, null))).toHaveClass('bg-chart-reference');
  });

  it('takes its tone from the polarity and not from the sign: a detectable rise of a lower-is-better rate is negative', () => {
    expect(fillOf(change(0.5, true, { polarity: 'lower_is_better' }))).toHaveClass('bg-negative-solid');
    expect(fillOf(change(-0.31, true, { polarity: 'lower_is_better' }))).toHaveClass('bg-positive-solid');
  });

  it('keeps a detectable change of a neutral metric neutral', () => {
    expect(fillOf(change(0.5, true, { polarity: 'neutral' }))).toHaveClass('bg-chart-reference');
  });

  it('colours the bar from the change input and not from the estimate of the interval', () => {
    // The estimate says up, the tested change says down: the tone follows the tested change
    expect(fillOf(DOWN, 0.5)).toHaveClass('bg-negative-solid');
  });

  it('shows the change as signed points from Delta, in neutral text when it is not detectable', () => {
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(MOVERS)} />);
    const [up, down, flat] = items();
    if (up === undefined || down === undefined || flat === undefined) throw new Error('Missing rows');
    expect(only(up, 'interval-delta')).toHaveTextContent('+50.0 pts');
    expect(within(up).getByText('+50.0 pts')).toHaveClass('text-positive-text');
    expect(within(down).getByText(formatMetricDelta(DOWN).text)).toHaveClass('text-negative-text');
    expect(within(flat).getByText('+4.0 pts')).toHaveClass('text-foreground-secondary');
    // The delta carries no tab stop: it sits in the hidden visual part
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('draws no change text for a change without a value', () => {
    const rows = [diverging('a', 'Row', compare(0.2, 0.1, 0.3, change(null, null)))];
    renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    expect(only(document.body, 'interval-delta')).toBeEmptyDOMElement();
  });
});

describe('IntervalBar change type', () => {
  it('admits the points axis only: a relative or count change is a type error', () => {
    const interval = { estimate: 0.2, low: 0.1, high: 0.3 };
    const base = {
      kind: 'compare',
      interval,
      test: 'interim',
      changeText: '+20.0 pts',
      intervalText: '+10 to +30 pts',
    } as const;
    const points: IntervalValue = { ...base, change: change(0.2, true) };
    // @ts-expect-error a relative change is not in points, so it cannot sit on the points axis
    const relative: IntervalValue = { ...base, change: { ...change(0.2, true), unit: 'relative' } };
    // @ts-expect-error a count change is not in points either
    const count: IntervalValue = { ...base, change: { ...change(0.2, true), unit: 'count' } };
    expect([points, relative, count]).toHaveLength(3);
  });
});

describe('IntervalBar thin and unknown rows', () => {
  const rows = [
    diverging('thin', 'crm pricing, Gemini', { kind: 'thin' }),
    diverging('own-words', 'crm reviews, Gemini', { kind: 'thin', text: '3 answers in the earlier window' }),
    diverging('none', 'crm demos, Gemini', { kind: 'none' }),
    diverging('reason', 'crm trials, Gemini', { kind: 'none', text: 'No answers in 28 days' }),
    diverging('bad', 'crm tools, Gemini', compare(Number.NaN, Number.NaN, Number.NaN, change(0.1, true))),
  ];

  it('says too few answers to compare in place of the bar, and draws nothing (R2)', () => {
    const { container } = renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    const [thin, ownWords] = items();
    if (thin === undefined || ownWords === undefined) throw new Error('Missing rows');
    expect(within(thin).getByText('Too few answers to compare')).toHaveClass('text-foreground-tertiary');
    expect(within(ownWords).getByText('3 answers in the earlier window')).toBeInTheDocument();
    expect(slot(container, 'interval-bar')).toHaveLength(0);
    expect(slot(container, 'interval-whisker')).toHaveLength(0);
    expect(slot(container, 'interval-zero')).toHaveLength(0);
  });

  it('says why a change is unknown and never writes 0 (R6)', () => {
    renderWithProviders(<IntervalBar {...divergingProps(rows)} />);
    const [, , none, reason, bad] = items();
    if (none === undefined || reason === undefined || bad === undefined) throw new Error('Missing rows');
    expect(within(none).getByText('No data')).toBeInTheDocument();
    expect(within(reason).getByText('No answers in 28 days')).toBeInTheDocument();
    // A change that is not a number is unknown too, not a bar at 0
    expect(within(bad).getByText('No data')).toBeInTheDocument();
    for (const item of [none, reason, bad]) expect(item.textContent).not.toMatch(ZERO);
  });
});

describe('IntervalBar dumbbell', () => {
  const rows = [
    dumbbell('a', 'ChatGPT', compare(0.15, -0.02, 0.3, change(0.15, false), '-2 to +30 pts'), {
      color: 'chart-2',
    }),
    dumbbell('b', 'Gemini', compare(0.3, 0.1, 0.45, UP), {
      previous: 0.1,
      current: 0.4,
      color: 'chart-1',
    }),
    dumbbell('c', 'Claude', compare(-0.1, -0.2, 0, DOWN), { previous: 0.3, current: 0.2, color: 'chart-other' }),
  ];

  it('draws a hollow dot for the previous rate and a filled one in the row colour for the current, on the rate axis', () => {
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(rows)} />);
    const [previous] = slot(container, 'interval-dot-previous');
    const [current] = slot(container, 'interval-dot-current');
    if (previous === undefined || current === undefined) throw new Error('Missing dots');
    expect(previous).toHaveClass('border-2', 'border-chart-reference', 'bg-surface', 'rounded-full', 'size-2.5');
    expect(current).toHaveClass('bg-chart-2', 'rounded-full', 'size-2.5');
    expect(left(previous)).toBeCloseTo(trackPercent(0.25, [0, 0.5]));
    expect(left(current)).toBeCloseTo(trackPercent(0.4, [0, 0.5]));
    expect(
      slot(container, 'interval-dot-current').map((dot) => dot.className.match(/bg-chart-[a-z0-9]+/)?.[0]),
    ).toEqual(['bg-chart-2', 'bg-chart-1', 'bg-chart-other']);
  });

  it('joins the two dots by a 2 px line and never draws a bar in the rate track', () => {
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(rows)} />);
    const [line] = slot(container, 'interval-link');
    if (line === undefined) throw new Error('Missing line');
    expect(line).toHaveClass('bg-border-strong', 'h-0.5');
    expect(left(line)).toBeCloseTo(50);
    expect(width(line)).toBeCloseTo(30);
    expect(slot(container, 'interval-bar')).toHaveLength(0);
  });

  it('draws the line from the left dot when the rate fell', () => {
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(rows)} />);
    const line = slot(container, 'interval-link')[2];
    if (line === undefined) throw new Error('Missing line');
    expect(left(line)).toBeCloseTo(40);
    expect(width(line)).toBeCloseTo(20);
  });

  it('draws the difference on its own aligned axis: a dot at the estimate, the whisker and a zero line', () => {
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(rows.slice(0, 1))} />);
    const dot = only(container, 'interval-change-dot');
    expect(left(dot)).toBeCloseTo(trackPercent(0.15, [-0.2, 0.2]));
    const whisker = only(container, 'interval-whisker');
    expect(left(whisker)).toBeCloseTo(trackPercent(-0.02, [-0.2, 0.2]));
    expect(left(whisker) + width(whisker)).toBeCloseTo(trackPercent(0.3, [-0.2, 0.2]));
    expect(left(only(container, 'interval-zero'))).toBeCloseTo(50);
  });

  it('colours the change dot by the tested change only (R5)', () => {
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(rows)} />);
    const dots = slot(container, 'interval-change-dot');
    expect(dots[0]).toHaveClass('bg-chart-reference');
    expect(dots[1]).toHaveClass('bg-positive-solid');
    expect(dots[2]).toHaveClass('bg-negative-solid');
    const undetected = [change(0.4, false), change(0.4, null)];
    for (const input of undetected) {
      const one = renderWithProviders(
        <IntervalBar {...dumbbellProps([dumbbell('x', 'Row', compare(0.4, 0.3, 0.5, input))])} />,
      );
      expect(only(one.container, 'interval-change-dot')).toHaveClass('bg-chart-reference');
      one.unmount();
    }
  });

  it('shows the change with Delta after the two axes', () => {
    renderWithProviders(<IntervalBar {...dumbbellProps(rows)} />);
    const [first, second] = items();
    if (first === undefined || second === undefined) throw new Error('Missing rows');
    expect(only(first, 'interval-delta')).toHaveTextContent('+15.0 pts');
    expect(within(second).getByText('+50.0 pts')).toHaveClass('text-positive-text');
  });

  it('says too few answers to compare when a window has no rate, with no dots (R2, R6)', () => {
    const missing = [
      dumbbell('p', 'Gemini', compare(0.1, 0, 0.2, UP), { previous: null }),
      dumbbell('c', 'Claude', compare(0.1, 0, 0.2, UP), { current: null }),
      dumbbell('t', 'Grok', { kind: 'thin' }),
      dumbbell('n', 'Copilot', { kind: 'none' }),
    ];
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(missing)} />);
    const [previous, current, thin, none] = items();
    if (previous === undefined || current === undefined || thin === undefined || none === undefined) {
      throw new Error('Missing rows');
    }
    for (const item of [previous, current, thin]) {
      expect(within(item).getByText('Too few answers to compare')).toBeInTheDocument();
    }
    expect(within(none).getByText('No data')).toBeInTheDocument();
    expect(slot(container, 'interval-dot-previous')).toHaveLength(0);
    expect(slot(container, 'interval-dot-current')).toHaveLength(0);
    expect(slot(container, 'interval-change-dot')).toHaveLength(0);
    for (const item of [previous, current, thin, none]) expect(item.textContent).not.toMatch(ZERO);
  });

  it('treats a rate that is not a number as a missing window, not a dot at the left edge (R2)', () => {
    const bad = [
      dumbbell('p', 'Gemini', compare(0.1, 0, 0.2, UP), { previous: Number.NaN }),
      dumbbell('c', 'Claude', compare(0.1, 0, 0.2, UP), { current: Number.POSITIVE_INFINITY }),
    ];
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(bad)} />);
    for (const item of items()) expect(within(item).getByText('Too few answers to compare')).toBeInTheDocument();
    expect(slot(container, 'interval-dot-previous')).toHaveLength(0);
    expect(slot(container, 'interval-dot-current')).toHaveLength(0);
  });

  it('says No data when the two rates are known but the interval is not a number (R6)', () => {
    const bad = [dumbbell('a', 'ChatGPT', compare(Number.NaN, Number.NaN, Number.NaN, change(0.1, true)))];
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(bad)} />);
    const [item] = items();
    if (item === undefined) throw new Error('Missing row');
    expect(within(item).getByText('No data')).toBeInTheDocument();
    expect(item.textContent).not.toMatch(ZERO);
    expect(slot(container, 'interval-dot-current')).toHaveLength(0);
    expect(slot(container, 'interval-change-dot')).toHaveLength(0);
  });

  it('gives both tracks a width of their own below 448 px, the rate track inside its column wrapper too', () => {
    const { container } = renderWithProviders(<IntervalBar {...dumbbellProps(rows.slice(0, 1))} />);
    const bands = slot(container, 'interval-band');
    expect(bands).toHaveLength(2);
    for (const band of bands) {
      expect(band.parentElement).toHaveClass('w-full', '@md:w-auto', '@md:flex-1', '@md:self-stretch');
    }
    // The rate track is a flex item of a column: it takes its height from h-6, with no flex-grow below 448 px
    const rateTrack = bands[0]?.parentElement;
    expect(rateTrack?.parentElement).toHaveClass('flex-col', '@md:flex-row');
    expect(rateTrack).toHaveClass('h-6');
    expect(rateTrack).not.toHaveClass('flex-1');
  });
});

describe('IntervalBar links and keyboard', () => {
  const linked: readonly DivergingRow[] = [
    diverging('a', 'best crm for startups, ChatGPT', compare(0.5, 0.09, 0.77, UP), {
      href: '/p/ai/prompts/a' as Route,
      tip: '25% to 75% (+50 pts), 2 of 8 then 6 of 8 answers',
      accessibleText: 'best crm for startups, ChatGPT: +50 pts, detectable',
    }),
    diverging('b', 'crm pricing, Gemini', compare(-0.31, -0.44, -0.1, DOWN)),
    diverging('c', 'crm reviews, Perplexity', compare(0.04, -0.03, 0.11, change(0.04, false)), {
      href: '/p/ai/prompts/c' as Route,
    }),
  ];

  it('makes a linked row a link named by its accessible text and reaches the links in row order', async () => {
    const { user } = renderWithProviders(<IntervalBar {...divergingProps(linked)} />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/p/ai/prompts/a', '/p/ai/prompts/c']);
    const first = screen.getByRole('link', { name: 'best crm for startups, ChatGPT: +50 pts, detectable' });
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
    for (const link of links) expect(link).toHaveClass('focus-visible:focus-ring', 'min-h-row');
    // The unlinked row takes no tab stop
    expect(screen.getByRole('list').querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('opens a tooltip with the label and the tip when a linked row takes focus', async () => {
    const { user } = renderWithProviders(<IntervalBar {...divergingProps(linked)} />);
    await user.tab();
    const tip = await screen.findByText('25% to 75% (+50 pts), 2 of 8 then 6 of 8 answers', {
      selector: '[data-slot="tooltip"] span',
    });
    expect(tip).toBeInTheDocument();
    expect(
      screen.getByText('best crm for startups, ChatGPT', { selector: '[data-slot="tooltip"] span' }),
    ).toBeInTheDocument();
  });

  it('puts no focusable element inside a hidden visual part, in either form', () => {
    for (const props of [
      divergingProps(linked),
      dumbbellProps([dumbbell('a', 'ChatGPT', compare(0.15, 0, 0.3, UP), { href: '/x' as Route })]),
    ]) {
      const { container, unmount } = renderWithProviders(<IntervalBar {...props} />);
      for (const hidden of container.querySelectorAll('[aria-hidden="true"]')) {
        expect(hidden.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
      }
      unmount();
    }
  });
});

describe('IntervalBar density', () => {
  it('draws 24 px tracks at Default and 16 px tracks at Compact', () => {
    const normal = renderWithProviders(<IntervalBar {...divergingProps(MOVERS)} />);
    for (const band of slot(normal.container, 'interval-band')) expect(band).toHaveClass('h-6');
    normal.unmount();
    const compact = renderWithProviders(<IntervalBar {...divergingProps(MOVERS, { density: 'compact' })} />);
    for (const band of slot(compact.container, 'interval-band')) {
      expect(band).toHaveClass('h-4');
      expect(band).not.toHaveClass('h-6');
    }
  });
});

describe('IntervalBar table and CSV', () => {
  const risky: readonly DivergingRow[] = [
    diverging('a', '=best crm', compare(0.5, 0.09, 0.77, UP, '+9 to +77 pts')),
    diverging('b', 'crm pricing', compare(-0.31, -0.44, -0.1, DOWN, '-44 to -10 pts')),
    diverging('c', 'thin one', { kind: 'thin' }),
    diverging('d', 'unknown', { kind: 'none' }),
    diverging('e', 'with words', { kind: 'none', text: '+No answers' }),
  ];

  it('is a table of label, change and interval for the diverging form, saying why a row has no change', () => {
    renderWithProviders(<IntervalBarTable {...divergingProps(risky)} />);
    const table = screen.getByRole('table', { name: 'Prompt movers' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Prompt', 'Change', '95% interval']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5);
    expect(within(rows[0] ?? table).getByRole('rowheader')).toHaveTextContent('=best crm');
    expect(
      within(rows[0] ?? table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['+50.0 pts', '+9 to +77 pts']);
    expect(
      within(rows[2] ?? table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Too few answers to compare', '']);
    expect(within(rows[3] ?? table).getByText('No data')).toBeInTheDocument();
    expect(within(rows[4] ?? table).getByText('+No answers')).toBeInTheDocument();
  });

  it('adds the previous and current rate, each beside its count, for the dumbbell form (R1)', () => {
    const rows = [
      dumbbell('a', 'ChatGPT', compare(0.15, -0.02, 0.3, change(0.15, false), '-2 to +30 pts')),
      dumbbell('b', 'Gemini', compare(0.1, 0, 0.2, UP), { previous: null, previousText: '3 answers' }),
    ];
    renderWithProviders(<IntervalBarTable {...dumbbellProps(rows)} />);
    const table = screen.getByRole('table', { name: 'Mention rate by engine' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Engine', 'Previous', 'Current', 'Change', '95% interval']);
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(
      within(first ?? table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['25.0%, 2 of 8', '40.0%, 6 of 15', '+15.0 pts', '-2 to +30 pts']);
    // A window without a rate is a gap, and the row says why
    expect(
      within(second ?? table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['', '40.0%, 6 of 15', 'Too few answers to compare', '']);
  });

  it('writes every text cell and every header through safeText, and a gap as an empty cell', () => {
    const csv = intervalBarCsv(divergingProps(risky, { labelHeader: '=Prompt' }), WORDS);
    // Fails for this reason if the formatter changes to an ASCII hyphen, which safeText would then quote
    expect(formatMetricDelta(DOWN).text.codePointAt(0)).toBe(0x2212);
    expect(csv.header).toEqual(["'=Prompt", 'Change', '95% interval']);
    expect(csv.rows).toEqual([
      ["'=best crm", "'+50.0 pts", "'+9 to +77 pts"],
      // The typographic minus of formatPointsDelta is not a formula character
      ['crm pricing', formatMetricDelta(DOWN).text, "'-44 to -10 pts"],
      ['thin one', 'Too few answers to compare', null],
      ['unknown', 'No data', null],
      ['with words', "'+No answers", null],
    ]);
  });

  it('writes the previous and current columns of the dumbbell, empty where a window has no rate', () => {
    const rows = [
      dumbbell('a', '@ChatGPT', compare(0.15, -0.02, 0.3, change(0.15, false), '-2 to +30 pts'), {
        previousText: '-25.0%, 2 of 8',
      }),
      dumbbell('b', 'Gemini', compare(0.1, 0, 0.2, UP), { current: null, currentText: '3 answers' }),
    ];
    const csv = intervalBarCsv(dumbbellProps(rows), { ...WORDS, previous: '=Before', current: '@Now' });
    expect(csv.header).toEqual(['Engine', "'=Before", "'@Now", 'Change', '95% interval']);
    expect(csv.rows).toEqual([
      ["'@ChatGPT", "'-25.0%, 2 of 8", '40.0%, 6 of 15', "'+15.0 pts", "'-2 to +30 pts"],
      ['Gemini', '25.0%, 2 of 8', null, 'Too few answers to compare', null],
    ]);
  });

  it('writes the header words of the caller through safeText too', () => {
    const csv = intervalBarCsv(divergingProps(risky), { ...WORDS, change: '+Change', interval: '-Interval' });
    expect(csv.header).toEqual(['Prompt', "'+Change", "'-Interval"]);
  });
});

describe('IntervalBar inside ChartFrame', () => {
  it('is the html body, swaps for its table on Table, and offers CSV but no PNG', async () => {
    const all = divergingProps(MOVERS);
    const { user } = renderWithProviders(
      <ChartFrame
        kind="html"
        variant="panel"
        title="Prompt movers"
        height={240}
        summary="Three prompts moved; one rise and one fall are detectable."
        status="ready"
        body={<IntervalBar {...all} />}
        table={<IntervalBarTable {...all} />}
        menu={{ fileName: 'prompt-movers', csv: intervalBarCsv(all, WORDS) }}
      />,
    );
    expect(screen.getByRole('list', { name: 'Prompt movers' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.queryByRole('list', { name: 'Prompt movers' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Prompt movers' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'More actions for Prompt movers' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Download CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Download PNG' })).toBeNull();
  });
});

describe('IntervalBar accessibility', () => {
  const linkedMovers = MOVERS.map((row, index) => ({ ...row, href: `/p/ai/prompts/${String(index)}` as Route }));
  const mixed: readonly DumbbellRow[] = [
    dumbbell('a', 'ChatGPT', compare(0.15, -0.02, 0.3, change(0.15, false)), { href: '/p/ai/chatgpt' as Route }),
    dumbbell('b', 'Gemini', compare(0.3, 0.1, 0.45, UP), { color: 'chart-1' }),
    dumbbell('c', 'Claude', { kind: 'thin' }),
    dumbbell('d', 'Grok', compare(0.1, 0, 0.2, UP), { previous: null }),
  ];

  it.each(['light', 'dark'])('has no violation for both forms and their tables in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      for (const props of [divergingProps(linkedMovers), dumbbellProps(mixed)]) {
        const bars = renderWithProviders(<IntervalBar {...props} />);
        expect(await axe(bars.container)).toHaveNoViolations();
        bars.unmount();
        const table = renderWithProviders(<IntervalBarTable {...props} />);
        expect(await axe(table.container)).toHaveNoViolations();
        table.unmount();
      }
    } finally {
      document.documentElement.className = '';
    }
  });
});
