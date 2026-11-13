import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { DETECTABLE, WITHIN, cell, engineOf, projectEngine, topicCell } from './compare/change-test-data';
import { ComparedWindowProvider, type ComparedWindow } from './compare/compared-window';
import { useRateColumns } from './rate-columns';
import type { EngineSummary, MetricCell, ProjectEngine } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

interface Row {
  cells: readonly EngineSummary[] | undefined;
}
const rowCells = (row: Row): readonly EngineSummary[] | undefined => row.cells;

const BOTH: ProjectEngine[] = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];
const CHAT_ONLY: ProjectEngine[] = [projectEngine('chatgpt_web')];
const WINDOW = { from: '2026-09-18', to: '2026-10-15' };

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
  searchParams = '',
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
  it('shows the change of the average over the engines that have a rate in both periods', () => {
    // Gemini has no previous period: it is in the shown average but in neither side of the change
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 20), null)] });
    expect(screen.getByTestId('cell')).toHaveTextContent('75%');
    expect(screen.getByTestId('cell')).toHaveTextContent('avg of 2');
    expect(screen.getByText('+30.0 pts')).toHaveClass('text-positive-text');
  });

  it('names the one engine the change is of when the others have no rate in the previous period', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 20), null)] });
    expect(screen.getByTestId('tip')).toHaveTextContent('Previous 20%, 12 of 60 answers');
    // One engine took part: the tip says which, so the points do not read as the average's change
    expect(screen.getByTestId('tip')).toHaveTextContent(
      'Change of ChatGPT only, the one engine with a rate in both periods',
    );
    expect(screen.getByTestId('tip')).not.toHaveTextContent('Average of');
  });

  it('pools the answers of two engines, says so, and tests them together', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] });
    expect(screen.getByText('+30.0 pts')).toBeInTheDocument();
    expect(screen.getByTestId('tip')).toHaveTextContent(
      'Average of 2 engines that have a rate in both periods, tested on pooled answers',
    );
    expect(screen.getByTestId('tip')).toHaveTextContent('Previous 20%, 20 of 100 answers');
    expect(screen.getByTestId('tip')).toHaveTextContent('Previous period: Sep 18 to Oct 15');
    // The engine count comes before the previous figure, and the unpaired test is named once
    const tip = screen.getByTestId('tip').textContent ?? '';
    expect(tip.indexOf('Average of 2')).toBeLessThan(tip.indexOf('Previous 20%'));
    expect(tip.match(/unpaired/g)).toHaveLength(1);
  });

  it('uses the engine own test when one engine is in scope', () => {
    render({ cells: [chat(WITHIN), gemini(cell(20, 20), cell(1, 20))] }, '', CHAT_ONLY);
    const delta = screen.getByText('+6.7 pts');
    expect(delta).toHaveClass('text-foreground-secondary');
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
    render({ cells: [topic] }, '', CHAT_ONLY);
    const delta = screen.getByText('+5.0 pts');
    expect(delta).toHaveClass('text-foreground-secondary');
    expect(screen.getByTestId('cell').textContent).not.toMatch(/detectable|within normal variation/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Detectable|Within normal variation|Interim/);
    expect(screen.getByTestId('tip')).toHaveTextContent('No test is told for this change');
  });

  it('is unchanged with comparison off: the same text and tooltip, no change', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] }, '?cmp=off');
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Previous|Average of|Detectable/);
  });

  it('names no window in the tooltip while comparison is off, even when the page holds one', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] }, '?cmp=off', undefined, WINDOW);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Previous period|Sep 18|Oct 15/);
  });

  it('says nothing in the cell and why in the tooltip when no engine has a previous period', () => {
    render({ cells: [engineOf('chatgpt_web', cell(30, 60), null), gemini(cell(20, 40), null)] });
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip')).toHaveTextContent('No answers in the previous period');
  });

  it('does not claim the previous period has no answers while the held read was not compared', () => {
    // Right after comparison is turned on the page still holds the read without `compare_window`
    render({ cells: [engineOf('chatgpt_web', cell(30, 60), null), gemini(cell(20, 40), null)] }, '', undefined, null);
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/previous period/i);
  });

  it('says there are too few answers when a previous period exists but gives no rate', () => {
    render({ cells: [chat([cell(30, 60), cell(2, 3)]), gemini(cell(20, 40), cell(1, 2))] });
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip')).toHaveTextContent('No engine has a rate in both periods');
  });

  it('agrees for a topic row and a prompt row with the same counts', () => {
    const prompt = chat(DETECTABLE);
    const topic = engineOf('chatgpt_web', topicCell(30, 60, 5), topicCell(12, 60, 4));
    const first = render({ cells: [prompt] }, '', CHAT_ONLY);
    const prompts = screen.getByTestId('cell').textContent;
    first.unmount();
    render({ cells: [topic] }, '', CHAT_ONLY);
    expect(screen.getByTestId('cell').textContent).toBe(prompts);
  });

  it('keeps the rate, the engine count and the change on one line', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] });
    expect(screen.getByTestId('cell').firstElementChild).toHaveClass('whitespace-nowrap');
  });

  it('is as wide as its type allows, so rate, count and change fit', () => {
    function Width(): ReactElement {
      const { mention, citation } = useRateColumns<Row>(BOTH, rowCells);
      return (
        <output data-testid="widths">
          {mention.width}/{citation.width}
        </output>
      );
    }
    renderWithProviders(<Width />);
    // The Citation rate column keeps the type's own width
    expect(screen.getByTestId('widths')).toHaveTextContent(/^200\/(?!200)/);
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
    render({ cells: [engine] }, '', CHAT_ONLY, WINDOW, 'citation');
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Previous/);
  });
});
