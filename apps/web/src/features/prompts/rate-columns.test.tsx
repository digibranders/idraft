import { cleanup, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { DETECTABLE, WITHIN, cell, engineOf, projectEngine, topicCell } from './compare/change-test-data';
import { ComparedWindowProvider, type ComparedWindow } from './compare/compared-window';
import { useRateColumns } from './rate-columns';
import type { EngineSummary, MetricCell, ProjectEngine, WeekCells } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/** The trend icon of the cell: its direction in `data-direction`, its tone in its class. */
const icon = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-slot="trend-icon"]');
  if (found === null) throw new Error('The cell has no trend icon');
  return found;
};

interface Row {
  cells: readonly EngineSummary[] | undefined;
}
const rowCells = (row: Row): readonly EngineSummary[] | undefined => row.cells;

const BOTH: ProjectEngine[] = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];
const CHAT_ONLY: ProjectEngine[] = [projectEngine('chatgpt_web')];
const WINDOW = { from: '2026-09-18', to: '2026-10-15' };
/** The page opens without a comparison: it is on only when the address says so. */
const ON = '?cmp=previous';

/** The Mention (or Citation) rate cell of a row and its tooltip, as the table draws them. */
function Cell({
  row,
  engines = BOTH,
  column = 'mention',
}: {
  row: Row;
  engines?: ProjectEngine[];
  column?: 'mention' | 'citation';
}): ReactElement {
  const columns = useRateColumns<Row>(engines, rowCells);
  const shown = columns[column];
  const tip = shown.cellTip?.(row);
  return (
    <>
      <div data-testid="cell">{shown.cell(row)}</div>
      <p data-testid="tip">{tip === undefined ? '' : `${tip.content}. ${tip.detail ?? ''}`}</p>
    </>
  );
}

const render = (
  row: Row,
  searchParams = ON,
  engines?: ProjectEngine[],
  window: ComparedWindow = WINDOW,
  column?: 'mention' | 'citation',
): ProvidedRender =>
  renderWithProviders(
    <ComparedWindowProvider value={window}>
      <Cell row={row} {...(engines === undefined ? {} : { engines })} {...(column === undefined ? {} : { column })} />
    </ComparedWindowProvider>,
    { searchParams },
  );

const chat = (pair: readonly [MetricCell, MetricCell]): EngineSummary => engineOf('chatgpt_web', pair[0], pair[1]);
const gemini = (now: MetricCell, before: MetricCell | null): EngineSummary => engineOf('gemini_web', now, before);

describe('the Mention rate cell change', () => {
  it('shows the change of the average over the platforms that have a rate in both periods', () => {
    // Gemini has no previous period: it is in the shown average but in neither side of the change
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 20), null)] });
    expect(screen.getByTestId('cell')).toHaveTextContent('75%');
    // The percent alone: the platforms the average is over are in the tooltip
    expect(screen.getByTestId('cell')).not.toHaveTextContent('avg of');
    expect(icon()).toHaveClass('text-positive-text');
    expect(icon()).toHaveAttribute('data-direction', 'up');
    // The points are not in the cell: they are in its tooltip
    expect(screen.getByTestId('cell')).not.toHaveTextContent('+30.0 pts');
    expect(screen.getByTestId('tip')).toHaveTextContent('Up 30.0 pts against the previous period, from 20% to 50%');
  });

  it('names the one platform the change is of when the others have no rate in the previous period', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 20), null)] });
    expect(screen.getByTestId('tip')).toHaveTextContent('Previous 20%, 12 of 60 answers');
    // One engine took part: the tip says which, so the points do not read as the average's change
    expect(screen.getByTestId('tip')).toHaveTextContent(
      'Change of ChatGPT only, the one platform with a rate in both periods',
    );
    expect(screen.getByTestId('tip')).not.toHaveTextContent('Average of');
  });

  it('pools the answers of two platforms, says so, and tests them together', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] });
    expect(icon()).toHaveAttribute('data-direction', 'up');
    expect(screen.getByTestId('tip')).toHaveTextContent(
      'Average of 2 platforms that have a rate in both periods, tested on pooled answers',
    );
    expect(screen.getByTestId('tip')).toHaveTextContent('Previous 20%, 20 of 100 answers');
    expect(screen.getByTestId('tip')).toHaveTextContent('Previous period: Sep 18 to Oct 15');
    // The engine count comes before the previous figure, and the unpaired test is named once
    const tip = screen.getByTestId('tip').textContent ?? '';
    expect(tip.indexOf('Average of 2')).toBeLessThan(tip.indexOf('Previous 20%'));
    expect(tip.match(/unpaired/g)).toHaveLength(1);
  });

  it('uses the platform own test when one platform is in scope', () => {
    render({ cells: [chat(WITHIN), gemini(cell(20, 20), cell(1, 20))] }, ON, CHAT_ONLY);
    expect(icon()).toHaveClass('text-foreground-secondary');
    expect(icon()).not.toHaveClass('text-positive-text');
    expect(screen.getByTestId('tip')).toHaveTextContent('Up 6.7 pts against the previous period');
    expect(screen.getByTestId('tip')).toHaveTextContent('Within normal variation');
    expect(screen.getByTestId('tip')).not.toHaveTextContent('Average of');
    expect(screen.getByTestId('tip')).not.toHaveTextContent('Change of ChatGPT only');
  });

  it('makes no claim when the weighted points and the pooled answers move apart, says why, and stays neutral', () => {
    // The weighted rate rose by 5 points while the answers pooled fell by 30
    const topic = engineOf(
      'chatgpt_web',
      { ...topicCell(30, 100, 5), value: 0.55 },
      { ...topicCell(60, 100, 4), value: 0.5 },
    );
    render({ cells: [topic] }, ON, CHAT_ONLY);
    expect(icon()).toHaveClass('text-foreground-secondary');
    expect(screen.getByTestId('tip')).toHaveTextContent('Up 5.0 pts against the previous period');
    expect(screen.getByTestId('cell').textContent).not.toMatch(/detectable|within normal variation/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Detectable|Within normal variation|Interim/);
    expect(screen.getByTestId('tip')).toHaveTextContent('This change is not tested because');
  });

  it('is unchanged with comparison off: the same text and tooltip, no change', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] }, '');
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Previous|Average of|Detectable/);
  });

  it('names no window in the tooltip while comparison is off, even when the page holds one', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] }, '', undefined, WINDOW);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Previous period|Sep 18|Oct 15/);
  });

  it('says nothing in the cell and why in the tooltip when no platform has a previous period', () => {
    render({ cells: [engineOf('chatgpt_web', cell(30, 60), null), gemini(cell(20, 40), null)] });
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip')).toHaveTextContent('No answers in the previous period');
  });

  it('does not claim the previous period has no answers while the held read was not compared', () => {
    // Right after comparison is turned on the page still holds the read without `compare_window`
    render({ cells: [engineOf('chatgpt_web', cell(30, 60), null), gemini(cell(20, 40), null)] }, ON, undefined, null);
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/previous period/i);
  });

  it('says there are too few answers when a previous period exists but gives no rate', () => {
    render({ cells: [chat([cell(30, 60), cell(2, 3)]), gemini(cell(20, 40), cell(1, 2))] });
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip')).toHaveTextContent('No platform has a rate in both periods');
  });

  it('agrees for a group row and a prompt row with the same counts', () => {
    const prompt = chat(DETECTABLE);
    const topic = engineOf('chatgpt_web', topicCell(30, 60, 5), topicCell(12, 60, 4));
    const first = render({ cells: [prompt] }, ON, CHAT_ONLY);
    const prompts = screen.getByTestId('cell').textContent;
    first.unmount();
    render({ cells: [topic] }, ON, CHAT_ONLY);
    expect(screen.getByTestId('cell').textContent).toBe(prompts);
  });

  it('keeps the rate and the change on one line', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] });
    expect(screen.getByTestId('cell').firstElementChild).toHaveClass('whitespace-nowrap');
  });

  it('says the direction and the verdict in words to a screen reader, as the tooltip does', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] });
    expect(icon()).toHaveTextContent('up 30.0 pts, detectable, interim test');
    expect(screen.getByTestId('tip')).toHaveTextContent('Up 30.0 pts');
    expect(screen.getByTestId('tip')).toHaveTextContent('Detectable change');
  });

  it('draws the icon of a fall pointing down, and a dash for a change that rounds to nothing', () => {
    render({ cells: [chat([cell(12, 60), cell(30, 60)])] }, ON, CHAT_ONLY);
    expect(icon()).toHaveAttribute('data-direction', 'down');
    expect(icon()).toHaveClass('text-negative-text');
    expect(screen.getByTestId('tip')).toHaveTextContent('Down 30.0 pts');
    cleanup();
    render({ cells: [chat([cell(30, 60), cell(30, 60)])] }, ON, CHAT_ONLY);
    expect(icon()).toHaveAttribute('data-direction', 'flat');
    expect(icon()).toHaveClass('text-foreground-secondary');
    expect(screen.getByTestId('tip')).toHaveTextContent('No change against the previous period, at 50%');
  });

  it('has no accessibility violation with a change', async () => {
    const { container } = render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the Citation rate cell', () => {
  it('has no change and no previous figure, whatever the cited cells did', () => {
    // A detectable rise of the Cited counts: only the Mention rate has a change in this package
    const base = engineOf('chatgpt_web', cell(30, 60), cell(30, 60));
    const engine: EngineSummary = {
      ...base,
      cited: cell(30, 60),
      previous: base.previous == null ? null : { ...base.previous, cited: cell(12, 60) },
    };
    render({ cells: [engine] }, ON, CHAT_ONLY, WINDOW, 'citation');
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Previous/);
  });
});

describe('the weekly rates in the tooltip of the Mention rate cell', () => {
  const week = (weekStart: string, value: number): WeekCells => ({
    week_start: weekStart,
    prompts: 1,
    is_pooled: false,
    mentioned: cell(Math.round(value * 8), 8),
    cited: cell(0, 8),
    share_of_voice: cell(0, 8),
  });
  const WITH_SERIES: Row = {
    cells: [
      {
        ...engineOf('chatgpt_web', cell(30, 60), cell(12, 60)),
        series: [week('2026-10-12', 0.25), week('2026-10-19', 0.5)],
      },
    ],
  };
  const renderSeries = (searchParams: string): ProvidedRender =>
    renderWithProviders(
      <ComparedWindowProvider value={WINDOW}>
        <Cell row={WITH_SERIES} engines={CHAT_ONLY} />
      </ComparedWindowProvider>,
      { searchParams },
    );

  it('names the rate of each week in the tooltip, and draws no line in the cell', () => {
    renderSeries(ON);
    expect(screen.getByTestId('cell')).toHaveTextContent('50%');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('tip')).toHaveTextContent('Weekly rates: 25%, 50%');
  });

  it('draws no icon and names no week without comparison', () => {
    renderSeries('');
    expect(document.querySelector('[data-slot="trend-icon"]')).toBeNull();
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Weekly rates/);
  });
});
