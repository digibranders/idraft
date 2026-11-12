import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { ChartFrame } from './chart-frame';
import {
  StepBars,
  StepBarsTable,
  stepBarsCsv,
  type Step,
  type StepBarsProps,
  type StepCsvWords,
  type StepGroup,
} from './step-bars';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const WORDS: StepCsvWords = {
  thin: (answers) => `${String(answers)} answers`,
  step: 'Step',
  count: 'Count',
  share: 'Of the step before',
};

function step(id: string, label: string, count: number | null, extra: Partial<Step> = {}): Step {
  const countText = count === null ? null : count.toLocaleString('en-US');
  return {
    id,
    label,
    count,
    countText,
    share: null,
    own: false,
    accessibleText: `${label}: ${countText ?? 'no data'}`,
    ...extra,
  };
}

const share = (text: string): Step['share'] => ({ kind: 'share', text });

function funnel(id: string, label: string): StepGroup {
  return {
    id,
    label,
    steps: [
      step('answers', 'Answers', 1800),
      step('named', 'Answers naming you', 612, {
        own: true,
        share: share('34% of answers'),
        accessibleText: 'Answers naming you: 612, 34% of answers',
      }),
      step('cited', 'Named and cited', 201, {
        own: true,
        share: share('33% of answers naming you'),
        accessibleText: 'Named and cited: 201, 33% of answers naming you',
      }),
    ],
  };
}

function props(
  groups: readonly StepGroup[] = [funnel('chatgpt', 'ChatGPT')],
  extra: Partial<StepBarsProps> = {},
): StepBarsProps {
  return { caption: 'Answer funnel', groups, scaleMax: 1800, groupHeader: 'Engine', ...extra };
}

const bars = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-slot="step-bar"]'));

const widthOf = (bar: HTMLElement): number => Number.parseFloat(bar.style.width);

const ZERO = /(^|[^0-9])0%?(\D|$)/;

describe('StepBars structure', () => {
  it('is one list per group, named by its visible label, with steps in order and read from the accessible text', () => {
    const { container } = renderWithProviders(
      <StepBars {...props([funnel('chatgpt', 'ChatGPT'), funnel('gemini', 'Gemini')])} />,
    );
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'ChatGPT' })).toBe(lists[0]);
    expect(screen.getByRole('list', { name: 'Gemini' })).toBe(lists[1]);
    const items = within(lists[0] ?? document.body).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('.sr-only')?.textContent)).toEqual([
      'Answers: 1,800',
      'Answers naming you: 612, 34% of answers',
      'Named and cited: 201, 33% of answers naming you',
    ]);
    // Every bar sits inside the hidden visual part, so a step is read once
    expect(bars(container)).toHaveLength(6);
    for (const bar of bars(container)) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('hides the group icon from assistive technology', () => {
    const group: StepGroup = { ...funnel('chatgpt', 'ChatGPT'), icon: <svg data-testid="logo" /> };
    renderWithProviders(<StepBars {...props([group])} />);
    expect(screen.getByTestId('logo').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('list', { name: 'ChatGPT' })).toBeInTheDocument();
  });
});

describe('StepBars scale', () => {
  it('draws counts on the shared scale from zero', () => {
    const { container } = renderWithProviders(<StepBars {...props()} />);
    const widths = bars(container).map(widthOf);
    expect(widths[0]).toBeCloseTo(100);
    expect(widths[1]).toBeCloseTo(34);
    expect(widths[2]).toBeCloseTo(11.17, 1);
  });

  it('compares two groups on the same scale', () => {
    const small: StepGroup = {
      id: 'gemini',
      label: 'Gemini',
      steps: [step('answers', 'Answers', 900), step('named', 'Answers naming you', 450, { own: true })],
    };
    const { container } = renderWithProviders(<StepBars {...props([funnel('chatgpt', 'ChatGPT'), small])} />);
    const widths = bars(container).map(widthOf);
    expect(widths[3]).toBeCloseTo(50);
    expect(widths[4]).toBeCloseTo(25);
    // No group has its own scale, so none is set apart
    expect(container.querySelector('.border-t')).toBeNull();
  });

  it('draws a group with its own scale on that scale, set apart by a top border, and never as a rate of the step before', () => {
    const sessions: StepGroup = {
      id: 'ga4',
      label: 'AI referral sessions (GA4)',
      scaleMax: 120,
      steps: [step('sessions', 'Sessions', 90, { own: true })],
    };
    const { container } = renderWithProviders(<StepBars {...props([funnel('chatgpt', 'ChatGPT'), sessions])} />);
    const widths = bars(container).map(widthOf);
    expect(widths[2]).toBeCloseTo(11.17, 1);
    expect(widths[3]).toBeCloseTo(75);
    const groups = Array.from(container.querySelectorAll('[data-slot="step-group"]'));
    expect(groups[0]).not.toHaveClass('border-t');
    expect(groups[1]).toHaveClass('border-t', 'border-border');
    // The first step of a group has no share (R11: another unit)
    expect(groups[1]?.querySelector('[data-slot="step-share"]')).toBeNull();
  });

  it('does not set the first group apart when it is the one with its own scale', () => {
    const sessions: StepGroup = {
      id: 'ga4',
      label: 'AI referral sessions (GA4)',
      scaleMax: 120,
      steps: [step('sessions', 'Sessions', 90, { own: true })],
    };
    const { container } = renderWithProviders(<StepBars {...props([sessions, funnel('chatgpt', 'ChatGPT')])} />);
    const groups = Array.from(container.querySelectorAll('[data-slot="step-group"]'));
    expect(groups[0]).not.toHaveClass('border-t');
    expect(groups[0]).not.toHaveClass('pt-4');
    expect(groups[1]).not.toHaveClass('border-t');
  });

  it('colours own steps chart-1 and the others chart-reference', () => {
    const { container } = renderWithProviders(<StepBars {...props()} />);
    const [answers, named, cited] = bars(container);
    expect(answers).toHaveClass('bg-chart-reference');
    expect(named).toHaveClass('bg-chart-1');
    expect(cited).toHaveClass('bg-chart-1');
    expect(container.querySelector('.bg-chart-bar-neutral')).toBeNull();
  });

  it('says own versus others in the label weight as well as the colour', () => {
    renderWithProviders(<StepBars {...props()} />);
    const labels = Array.from(document.querySelectorAll('[data-slot="step-label"]'));
    expect(labels.map((label) => label.textContent)).toEqual(['Answers', 'Answers naming you', 'Named and cited']);
    expect(labels[0]).toHaveClass('type-body');
    expect(labels[0]).not.toHaveClass('type-body-strong');
    expect(labels[1]).toHaveClass('type-body-strong');
    expect(labels[2]).toHaveClass('type-body-strong');
  });

  it('draws a step larger than the one before at its own length and clamps a count past the scale', () => {
    const odd: StepGroup = {
      id: 'odd',
      label: 'Odd',
      steps: [
        step('a', 'Valid answers', 400),
        step('b', 'Named', 900, { share: share('225% of valid answers') }),
        step('c', 'Past the scale', 5000),
      ],
    };
    const { container } = renderWithProviders(<StepBars {...props([odd])} />);
    const widths = bars(container).map(widthOf);
    expect(widths[0]).toBeCloseTo(22.22, 1);
    expect(widths[1]).toBeCloseTo(50);
    expect(widths[2]).toBe(100);
    // The share is the caller's words, shown as given
    expect(screen.getByText('225% of valid answers')).toBeInTheDocument();
  });

  it('draws no bar, and no NaN width, when the scale is not usable', () => {
    const { container } = renderWithProviders(<StepBars {...props(undefined, { scaleMax: 0 })} />);
    for (const bar of bars(container)) expect(widthOf(bar)).toBe(0);
  });

  it('draws a negative or NaN count at width 0, never a negative or NaN width', () => {
    const bad: StepGroup = {
      id: 'bad',
      label: 'Bad',
      steps: [step('neg', 'Negative', -5), step('nan', 'Not a number', Number.NaN, { countText: 'NaN' })],
    };
    const { container } = renderWithProviders(<StepBars {...props([bad])} />);
    const found = bars(container);
    expect(found).toHaveLength(2);
    for (const bar of found) expect(bar.style.width).toBe('0%');
  });
});

describe('StepBars counts and shares', () => {
  it('shows each count and the share of the step before after it, and none on the first step', () => {
    renderWithProviders(<StepBars {...props()} />);
    const [first, second, third] = screen.getAllByRole('listitem');
    if (first === undefined || second === undefined || third === undefined) throw new Error('Missing steps');
    expect(first.querySelector('[data-slot="step-share"]')).toBeNull();
    expect(first).toHaveTextContent('1,800');
    const expected: [HTMLElement, string, string][] = [
      [second, '612', '34% of answers'],
      [third, '201', '33% of answers naming you'],
    ];
    for (const [item, count, text] of expected) {
      const countNode = item.querySelector('[data-slot="step-count"]');
      const shareNode = item.querySelector('[data-slot="step-share"]');
      expect(countNode).toHaveTextContent(count);
      expect(shareNode).toHaveTextContent(text);
      // Document order: count first, then the share (R1, a count beside every percent)
      expect(countNode?.compareDocumentPosition(shareNode ?? item) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('says "3 answers" for a share over too few answers, with no percent (R2)', () => {
    const thin: StepGroup = {
      id: 'thin',
      label: 'Gemini',
      steps: [step('a', 'Valid answers', 3), step('b', 'Named', 1, { share: { kind: 'thin', answers: 3 } })],
    };
    renderWithProviders(<StepBars {...props([thin])} />);
    const item = screen.getAllByRole('listitem')[1];
    if (item === undefined) throw new Error('Missing step');
    const words = within(item).getByText('3 answers');
    expect(words).toHaveClass('text-foreground-tertiary');
    expect(item.querySelector('[data-slot="step-share"]')).toContainElement(words);
    expect(item).not.toHaveTextContent('%');
  });

  it('says why a count is unknown, with no bar and no zero (R6)', () => {
    const unknown: StepGroup = {
      id: 'ga4',
      label: 'AI referral sessions (GA4)',
      steps: [
        step('connected', 'Sessions', null, {
          noneText: 'GA4 not connected',
          accessibleText: 'Sessions: GA4 not connected',
        }),
        step('plain', 'Conversions', null),
      ],
    };
    const { container } = renderWithProviders(<StepBars {...props([unknown])} />);
    expect(bars(container)).toHaveLength(0);
    const [reason, plain] = screen.getAllByRole('listitem');
    if (reason === undefined || plain === undefined) throw new Error('Missing steps');
    expect(within(reason).getAllByText('GA4 not connected').length).toBeGreaterThan(0);
    expect(within(plain).getAllByText('No data').length).toBeGreaterThan(0);
    for (const item of [reason, plain]) expect(item.textContent).not.toMatch(ZERO);
  });

  it('treats a count without its words as unknown: no bar, "No data", an empty CSV cell', () => {
    const half: StepGroup = { id: 'half', label: 'Half', steps: [step('a', 'Sessions', 5, { countText: null })] };
    const { container } = renderWithProviders(<StepBars {...props([half])} />);
    expect(bars(container)).toHaveLength(0);
    expect(within(screen.getByRole('listitem')).getAllByText('No data').length).toBeGreaterThan(0);
    expect(stepBarsCsv(props([half]), WORDS).rows).toEqual([['Half', 'Sessions', null, null]]);
  });

  it('writes an unknown count in the table as the reason, never a number', () => {
    const half: StepGroup = { id: 'half', label: 'Half', steps: [step('a', 'Sessions', 5, { countText: null })] };
    renderWithProviders(<StepBarsTable {...props([half])} />);
    const row = within(screen.getByRole('table')).getAllByRole('row')[1] ?? document.body;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Sessions', 'No data', '']);
  });

  it('keeps a real count of zero as a zero-length bar with its count', () => {
    const zero: StepGroup = { id: 'z', label: 'Gemini', steps: [step('named', 'Named', 0, { own: true })] };
    const { container } = renderWithProviders(<StepBars {...props([zero])} />);
    expect(widthOf(bars(container)[0] ?? document.body)).toBe(0);
    expect(screen.getByRole('listitem')).toHaveTextContent('0');
  });

  it('keeps the value in flow in its own column so a full bar never meets its count', () => {
    const { container } = renderWithProviders(<StepBars {...props()} />);
    expect(container.querySelector('.absolute')).toBeNull();
    const column = container.querySelector('[data-slot="step-count-column"]');
    expect(column).toHaveClass('w-28', 'shrink-0');
    expect(column?.previousElementSibling?.querySelector('[data-slot="step-bar"]')).not.toBeNull();
  });

  it('cuts a long count short in its column and shows it whole in a title', () => {
    const long: StepGroup = {
      id: 'long',
      label: 'Sessions',
      steps: [step('a', 'Sessions', 12345678, { countText: '12,345,678 sessions' })],
    };
    const { container } = renderWithProviders(<StepBars {...props([long])} />);
    const column = container.querySelector('[data-slot="step-count-column"]');
    expect(column).toHaveClass('truncate');
    expect(column).toHaveAttribute('title', '12,345,678 sessions');
  });

  it('gives every row a share slot of the same fixed width, empty on the first step, so every track is as wide', () => {
    const { container } = renderWithProviders(
      <StepBars {...props([funnel('chatgpt', 'ChatGPT'), funnel('gemini', 'Gemini')])} />,
    );
    const slots = Array.from(container.querySelectorAll('[data-slot="step-share-slot"]'));
    expect(slots).toHaveLength(6);
    for (const slot of slots) expect(slot).toHaveClass('@md:w-48', '@md:shrink-0');
    expect(slots[0]).toBeEmptyDOMElement();
    expect(slots[1]).toHaveTextContent('34% of answers');
    const tracks = Array.from(container.querySelectorAll('[data-slot="step-track"]'));
    expect(tracks).toHaveLength(6);
    for (const track of tracks) expect(track.className).toBe(tracks[0]?.className);
  });

  it('cuts a long share short in its slot and shows it whole in a title', () => {
    const wordy: StepGroup = {
      id: 'wordy',
      label: 'Wordy',
      steps: [
        step('a', 'Valid answers', 400),
        step('b', 'Named', 200, { share: share('50% of valid answers that came back in this period') }),
      ],
    };
    const { container } = renderWithProviders(<StepBars {...props([wordy])} />);
    const slot = container.querySelectorAll('[data-slot="step-share-slot"]')[1];
    expect(slot).toHaveClass('truncate');
    expect(slot).toHaveAttribute('title', '50% of valid answers that came back in this period');
  });
});

describe('StepBars links and keyboard', () => {
  const linked: StepGroup = {
    ...funnel('chatgpt', 'ChatGPT'),
    steps: funnel('chatgpt', 'ChatGPT').steps.map((item, index) =>
      index === 1 ? item : { ...item, href: `/p/ai/step-${item.id}` as Route },
    ),
  };

  it('makes a linked step a link named by its accessible text and reaches the links in order', async () => {
    const { user } = renderWithProviders(<StepBars {...props([linked])} />);
    const first = screen.getByRole('link', { name: 'Answers: 1,800' });
    const third = screen.getByRole('link', { name: 'Named and cited: 201, 33% of answers naming you' });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(third).toHaveFocus();
    expect(first).toHaveClass('focus-visible:focus-ring');
    expect(third).toHaveClass('focus-visible:focus-ring');
    // The unlinked step takes no tab stop
    expect(screen.getByRole('list').querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('puts no focusable element inside a hidden visual part', () => {
    const { container } = renderWithProviders(<StepBars {...props([linked])} />);
    for (const hidden of container.querySelectorAll('[aria-hidden="true"]')) {
      expect(hidden.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
    }
  });
});

describe('StepBars density', () => {
  it('draws 24 px bars at Default and 16 px bars at Compact', () => {
    const normal = renderWithProviders(<StepBars {...props()} />);
    for (const bar of bars(normal.container)) expect(bar).toHaveClass('h-6');
    normal.unmount();
    const compact = renderWithProviders(<StepBars {...props(undefined, { density: 'compact' })} />);
    for (const bar of bars(compact.container)) {
      expect(bar).toHaveClass('h-4');
      expect(bar).not.toHaveClass('h-6');
    }
  });
});

describe('StepBars table and CSV', () => {
  const group: StepGroup = {
    id: 'risky',
    label: '=HYPERLINK("x")',
    steps: [
      step('a', '+Answers', 1800),
      step('b', 'Named', 3, { share: { kind: 'thin', answers: 3 } }),
      step('c', 'Sessions', null),
      step('d', 'Cited', 201, { countText: '-201', share: share('@34% of answers') }),
    ],
  };

  it('is a table with group, step, count and share columns and one row per step', () => {
    renderWithProviders(<StepBarsTable {...props([funnel('chatgpt', 'ChatGPT'), group])} />);
    const table = screen.getByRole('table', { name: 'Answer funnel' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Engine', 'Step', 'Count', 'Of the step before']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(7);
    // The first column (the group) is the row header
    const second = within(rows[1] ?? table);
    expect(second.getByRole('rowheader')).toHaveTextContent('ChatGPT');
    expect(second.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Answers naming you',
      '612',
      '34% of answers',
    ]);
    expect(within(rows[0] ?? table).getAllByRole('cell')[2]).toBeEmptyDOMElement();
    // R2 in the table, and an unknown count says so instead of 0
    expect(within(rows[4] ?? table).getByText('3 answers')).toBeInTheDocument();
    expect(within(rows[5] ?? table).getByText('No data')).toBeInTheDocument();
  });

  it('writes every text cell and the header through safeText, thin as its words and an unknown count as an empty cell', () => {
    const csv = stepBarsCsv(props([group], { groupHeader: '=Engine' }), WORDS);
    expect(csv.header).toEqual(["'=Engine", 'Step', 'Count', 'Of the step before']);
    expect(csv.rows).toEqual([
      ['\'=HYPERLINK("x")', "'+Answers", '1,800', null],
      ['\'=HYPERLINK("x")', 'Named', '3', '3 answers'],
      ['\'=HYPERLINK("x")', 'Sessions', null, null],
      ['\'=HYPERLINK("x")', 'Cited', "'-201", "'@34% of answers"],
    ]);
  });

  it('writes the caller words of the step headers through safeText too', () => {
    const csv = stepBarsCsv(props(), { ...WORDS, step: '@Step', count: '=Count', share: '-Share' });
    expect(csv.header).toEqual(['Engine', "'@Step", "'=Count", "'-Share"]);
  });
});

describe('StepBars inside ChartFrame', () => {
  it('is the html body, swaps for its table on Table, and offers CSV but no PNG', async () => {
    const all = props([funnel('chatgpt', 'ChatGPT')]);
    const { user } = renderWithProviders(
      <ChartFrame
        kind="html"
        variant="panel"
        title="Answer funnel"
        height={180}
        summary="ChatGPT named you in 34 percent of answers."
        status="ready"
        body={<StepBars {...all} />}
        table={<StepBarsTable {...all} />}
        menu={{ fileName: 'answer-funnel', csv: stepBarsCsv(all, WORDS) }}
      />,
    );
    expect(screen.getByRole('list', { name: 'ChatGPT' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.queryByRole('list', { name: 'ChatGPT' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Answer funnel' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'More actions for Answer funnel' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Download CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Download PNG' })).toBeNull();
  });
});

describe('StepBars accessibility', () => {
  const linkedGroup: StepGroup = {
    ...funnel('chatgpt', 'ChatGPT'),
    steps: funnel('chatgpt', 'ChatGPT').steps.map((item) => ({ ...item, href: `/p/ai/${item.id}` as Route })),
  };
  const mixed: StepGroup = {
    id: 'ga4',
    label: 'AI referral sessions (GA4)',
    scaleMax: 120,
    steps: [
      step('a', 'Sessions', 90, { own: true, share: { kind: 'thin', answers: 2 } }),
      step('b', 'Conversions', null, { noneText: 'GA4 not connected' }),
    ],
  };

  it.each(['light', 'dark'])('has no violation for the bars and the table in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const bars_ = renderWithProviders(<StepBars {...props([linkedGroup, mixed])} />);
      expect(await axe(bars_.container)).toHaveNoViolations();
      bars_.unmount();
      const table = renderWithProviders(<StepBarsTable {...props([linkedGroup, mixed])} />);
      expect(await axe(table.container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
