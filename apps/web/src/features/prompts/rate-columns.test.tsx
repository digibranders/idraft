import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { ComparedWindowProvider } from './compare/compared-window';
import { DETECTABLE, WITHIN, cell, engineOf, projectEngine, topicCell } from './compare/change-test-data';
import { useRateColumns } from './rate-columns';
import type { EngineSummary, MetricCell, ProjectEngine } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

interface Row {
  cells: readonly EngineSummary[] | undefined;
}
const cellsOf = (row: Row): readonly EngineSummary[] | undefined => row.cells;

const BOTH: ProjectEngine[] = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];
const CHAT_ONLY: ProjectEngine[] = [projectEngine('chatgpt_web')];
const WINDOW = { from: '2026-09-18', to: '2026-10-15' };

/** The Mention rate cell of a row and its tooltip, as the table draws them. */
function Cell({ row, engines = BOTH }: { row: Row; engines?: ProjectEngine[] }): ReactElement {
  const { mention } = useRateColumns<Row>(engines, cellsOf);
  const tip = mention.cellTip?.(row);
  return (
    <>
      <div data-testid="cell">{mention.cell(row)}</div>
      <p data-testid="tip">{tip === undefined ? '' : `${tip.content}. ${tip.detail ?? ''}`}</p>
    </>
  );
}

const render = (row: Row, searchParams = '', engines?: ProjectEngine[]): ProvidedRender =>
  renderWithProviders(
    <ComparedWindowProvider value={WINDOW}>
      <Cell row={row} {...(engines === undefined ? {} : { engines })} />
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

  it('leaves an engine without a rate in the previous period out of both sides and says how many took part', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 20), null)] });
    expect(screen.getByTestId('tip')).toHaveTextContent('Previous 20%, 12 of 60 answers');
    // One engine took part, so it is that engine's own test and not an average
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
  });

  it('uses the engine own test when one engine is in scope', () => {
    render({ cells: [chat(WITHIN), gemini(cell(20, 20), cell(1, 20))] }, '', CHAT_ONLY);
    const delta = screen.getByText('+6.7 pts');
    expect(delta).toHaveClass('text-foreground-secondary');
    expect(screen.getByTestId('tip')).toHaveTextContent('Within normal variation');
    expect(screen.getByTestId('tip')).not.toHaveTextContent('Average of');
  });

  it('makes no claim when the weighted points and the pooled answers move apart, and stays neutral', () => {
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
  });

  it('is unchanged with comparison off: the same text and tooltip, no change', () => {
    render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] }, '?cmp=off');
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip').textContent).not.toMatch(/Previous|Average of|Detectable/);
  });

  it('says nothing in the cell and why in the tooltip when no engine has a previous period', () => {
    render({ cells: [engineOf('chatgpt_web', cell(30, 60), null), gemini(cell(20, 40), null)] });
    expect(screen.getByTestId('cell').textContent).not.toMatch(/pts/);
    expect(screen.getByTestId('tip')).toHaveTextContent('No answers in the previous period');
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

  it('has no accessibility violation with a change', async () => {
    const { container } = render({ cells: [chat(DETECTABLE), gemini(cell(20, 40), cell(8, 40))] });
    expect(await axe(container)).toHaveNoViolations();
  });
});
