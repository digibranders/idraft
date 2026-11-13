import { screen, within } from '@testing-library/react';
import { useMemo, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { compareColumns } from './compare-columns';
import { DETECTABLE, WITHIN, cell, engineOf, projectEngine } from '../compare/change-test-data';
import { type ComparedWindow } from '../compare/compared-window';
import { usePromptColumns, type PromptRow } from '../prompt-columns';
import type { RateMetric } from '../prompt-model';
import { PROMPT_COLUMN_ENTRIES } from '../seams/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { useSortedRows } from '@/components/app/data-table/use-sorted-rows';
import type { EngineSummary, MetricCell, ProjectEngine } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const WINDOW = { from: '2026-09-18', to: '2026-10-15' };
const CHAT_ENGINE = projectEngine('chatgpt_web');
const BOTH: ProjectEngine[] = [CHAT_ENGINE, projectEngine('gemini_web')];
const CHAT_ONLY: ProjectEngine[] = [CHAT_ENGINE];

/** A row of the Prompts tab with the engine cells its summary has; `undefined` is a summary that has not loaded. */
const rowOf = (cells: readonly EngineSummary[] | undefined, id = 'prompt'): PromptRow =>
  ({
    prompt: { prompt_id: id, current_version: { text: id }, is_branded: false },
    summary: cells === undefined ? undefined : { prompt_id: id, engines: cells },
    countsLoaded: cells !== undefined,
    topics: null,
    topicList: [],
    country: null,
  }) as unknown as PromptRow;

const chat = (pair: readonly [MetricCell, MetricCell]): EngineSummary => engineOf('chatgpt_web', pair[0], pair[1]);
const gemini = (now: MetricCell, before: MetricCell | null): EngineSummary => engineOf('gemini_web', now, before);

/** The columns the Prompts tab builds, as the screen gives them to its table: the entry gets its context there. */
function useAllColumns(
  engines: readonly ProjectEngine[],
  metric: RateMetric,
  window: ComparedWindow,
): readonly DataTableColumn<PromptRow>[] {
  return usePromptColumns(engines, metric, window).columns;
}

function useChangeColumns(
  engines: readonly ProjectEngine[],
  metric: RateMetric,
  window: ComparedWindow,
): readonly DataTableColumn<PromptRow>[] {
  const columns = useAllColumns(engines, metric, window);
  return useMemo(() => columns.filter((column) => column.id.startsWith('change_')), [columns]);
}

/** Every change column of a row as the table draws it: the cell, and the tip the table gives the focused cell. */
function Cells({
  row,
  engines,
  metric,
  window,
}: {
  row: PromptRow;
  engines: ProjectEngine[];
  metric: RateMetric;
  window: ComparedWindow;
}): ReactElement {
  const columns = useChangeColumns(engines, metric, window);
  return (
    <>
      {columns.map((column) => (
        <div key={column.id}>
          <div data-testid={column.id}>{column.cell(row)}</div>
          <p data-testid={`${column.id}-tip`}>{column.cellTip?.(row)?.content ?? ''}</p>
        </div>
      ))}
    </>
  );
}

const render = (
  row: PromptRow,
  searchParams = '',
  options: { engines?: ProjectEngine[]; metric?: RateMetric; window?: ComparedWindow } = {},
): ProvidedRender =>
  renderWithProviders(
    <Cells
      row={row}
      engines={options.engines ?? BOTH}
      metric={options.metric ?? 'mention'}
      window={options.window === undefined ? WINDOW : options.window}
    />,
    { searchParams },
  );

const tipOf = (id: string): HTMLElement => screen.getByTestId(`${id}-tip`);

describe('the change columns of the Prompts tab', () => {
  it('is an entry of the seam, so the table lists its columns', () => {
    expect(PROMPT_COLUMN_ENTRIES).toContain(compareColumns);
  });

  it('builds one column per engine shown, hidden by default, last in the table, with its own unique ids', () => {
    function Ids(): ReactElement {
      const columns = useAllColumns(BOTH, 'mention', WINDOW);
      const ids = columns.map((column) => column.id);
      const changes = columns.filter((column) => column.id.startsWith('change_'));
      return (
        <>
          <output data-testid="unique">{String(new Set(ids).size === ids.length)}</output>
          <output data-testid="last">{ids.slice(-2).join(' ')}</output>
          <output data-testid="changes">
            {changes.map((column) => `${column.id}:${String(column.defaultVisible)}:${column.type}`).join(' ')}
          </output>
        </>
      );
    }
    renderWithProviders(<Ids />);
    expect(screen.getByTestId('unique')).toHaveTextContent('true');
    expect(screen.getByTestId('last')).toHaveTextContent('change_chatgpt_web change_gemini_web');
    expect(screen.getByTestId('changes')).toHaveTextContent(
      'change_chatgpt_web:false:volumeTrend change_gemini_web:false:volumeTrend',
    );
  });

  describe('the header', () => {
    function Headers({ metric }: { metric: RateMetric }): ReactElement {
      const columns = useChangeColumns(BOTH, metric, WINDOW);
      return (
        <>
          {columns.map((column) => (
            <p key={column.id} data-testid={column.id}>
              {column.header}|{column.headerTooltip}
            </p>
          ))}
        </>
      );
    }

    it('names the engine, and says in lower case which rate of the page it follows', () => {
      renderWithProviders(<Headers metric="citation" />);
      expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent(/^ChatGPT change\|/);
      expect(screen.getByTestId('change_gemini_web')).toHaveTextContent(/^Gemini change\|/);
      expect(screen.getByTestId('change_gemini_web')).toHaveTextContent(
        "Change in points of this engine's citation rate since the previous period. Coloured only when the change is detectable.",
      );
    });

    it('names the mention rate for the Mention metric', () => {
      renderWithProviders(<Headers metric="mention" />);
      expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent("this engine's mention rate since");
    });

    it('says that no test exists for share of voice, and never says it is coloured', () => {
      renderWithProviders(<Headers metric="sov" />);
      const header = screen.getByTestId('change_gemini_web');
      expect(header).toHaveTextContent("Change in points of this engine's share of voice since the previous period.");
      expect(header).toHaveTextContent('No test exists for share of voice, so its change is never coloured.');
      expect(header.textContent).not.toMatch(/Coloured only when/);
    });
  });

  it('draws a delta of the interim test, coloured only when the change is detectable', () => {
    render(rowOf([chat(DETECTABLE), gemini(WITHIN[0], WITHIN[1])]));
    expect(within(screen.getByTestId('change_chatgpt_web')).getByText('+30.0 pts')).toHaveClass('text-positive-text');
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('detectable');
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('interim test');
    expect(within(screen.getByTestId('change_gemini_web')).getByText('+6.7 pts')).toHaveClass(
      'text-foreground-secondary',
    );
    expect(screen.getByTestId('change_gemini_web')).toHaveTextContent('within normal variation');
    expect(screen.getByTestId('change_gemini_web')).toHaveTextContent('interim test');
  });

  it('colours a fall by the test, not by its sign', () => {
    render(rowOf([chat([DETECTABLE[1], DETECTABLE[0]]), gemini(WITHIN[1], WITHIN[0])]));
    // The formatter writes the true minus sign, which is not ASCII: the pattern takes any one character for it
    expect(within(screen.getByTestId('change_chatgpt_web')).getByText(/^.30\.0 pts$/)).toHaveClass(
      'text-negative-text',
    );
    expect(within(screen.getByTestId('change_gemini_web')).getByText(/^.6\.7 pts$/)).toHaveClass(
      'text-foreground-secondary',
    );
  });

  it('gives the focused cell the previous value with its answers, the window and the verdict', () => {
    render(rowOf([chat(DETECTABLE), gemini(WITHIN[0], WITHIN[1])]));
    const tip = tipOf('change_chatgpt_web');
    expect(tip).toHaveTextContent(/Previous 20%, 12 of 60 answers/);
    expect(tip).toHaveTextContent(/Previous period: Sep 18 to Oct 15/);
    expect(tip).toHaveTextContent(/Detectable change/);
    expect(tip).toHaveTextContent(/Interim test: unpaired/);
    expect(tipOf('change_gemini_web')).toHaveTextContent(/Within normal variation/);
  });

  it('adds no tab stop of its own: the cell holds nothing the keyboard can reach', () => {
    render(rowOf([chat(DETECTABLE), gemini(cell(20, 40), null)]));
    // The first cell has a change and a tip, the second is n/a with a reason: the table's own cell is the tab stop of both
    for (const id of ['change_chatgpt_web', 'change_gemini_web']) {
      expect(tipOf(id).textContent).not.toBe('');
      expect(screen.getByTestId(id).querySelectorAll('[tabindex], a, button, input, select, textarea')).toHaveLength(0);
    }
  });

  it('is aligned like its header and the other numeric columns: to the left, never pushed to the right edge', () => {
    render(rowOf([chat(DETECTABLE), gemini(cell(20, 40), null)]));
    // The header of a volumeTrend column is left aligned, so a cell flushed right would sit away from its header
    for (const id of ['change_chatgpt_web', 'change_gemini_web']) {
      expect(screen.getByTestId(id).querySelector('.justify-end')).toBeNull();
      expect(screen.getByTestId(id).querySelector('.text-right')).toBeNull();
    }
  });

  it('follows the metric of the page: Mention, Citation or Share of voice', () => {
    const base = engineOf('chatgpt_web', cell(30, 60), cell(12, 60), [cell(36, 60), cell(6, 60)]);
    const engine: EngineSummary = {
      ...base,
      cited: cell(48, 60),
      previous: base.previous == null ? null : { ...base.previous, cited: cell(6, 60) },
    };
    const row = rowOf([engine]);
    const mention = render(row, '', { engines: CHAT_ONLY, metric: 'mention' });
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('+30.0 pts');
    mention.unmount();
    const citation = render(row, '', { engines: CHAT_ONLY, metric: 'citation' });
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('+70.0 pts');
    citation.unmount();
    render(row, '', { engines: CHAT_ONLY, metric: 'sov' });
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('+50.0 pts');
  });

  it('keeps share of voice neutral and says that no test exists for it', () => {
    render(rowOf([engineOf('chatgpt_web', cell(30, 60), cell(12, 60), [cell(48, 60), cell(12, 60)])]), '', {
      engines: CHAT_ONLY,
      metric: 'sov',
    });
    const delta = within(screen.getByTestId('change_chatgpt_web')).getByText('+60.0 pts');
    expect(delta).toHaveClass('text-foreground-secondary');
    expect(screen.getByTestId('change_chatgpt_web').textContent).not.toMatch(/detectable|within normal variation/i);
    expect(tipOf('change_chatgpt_web')).toHaveTextContent(/No test exists for share of voice/);
  });

  it('is n/a with Comparison is off while comparison is off, and draws no change', () => {
    render(rowOf([chat(DETECTABLE), gemini(WITHIN[0], WITHIN[1])]), '?cmp=off');
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('n/a');
    expect(screen.getByTestId('change_chatgpt_web').textContent).not.toMatch(/pts/);
    expect(tipOf('change_chatgpt_web')).toHaveTextContent(/^Comparison is off$/);
  });

  it('says No answers in the previous period for an engine that has none, never 0', () => {
    render(rowOf([chat(DETECTABLE), gemini(cell(20, 40), null)]));
    expect(screen.getByTestId('change_gemini_web')).toHaveTextContent('n/a');
    expect(screen.getByTestId('change_gemini_web').textContent).not.toMatch(/0\.0|pts/);
    expect(tipOf('change_gemini_web')).toHaveTextContent(/^No answers in the previous period$/);
  });

  it('says there are too few answers when the previous period gives no rate', () => {
    render(rowOf([chat([cell(30, 60), cell(2, 3)]), gemini(WITHIN[0], WITHIN[1])]));
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('n/a');
    expect(tipOf('change_chatgpt_web')).toHaveTextContent(/^Too few answers in one of the periods for a rate$/);
  });

  it('says nothing about the previous period while the held read was not compared', () => {
    render(rowOf([chat(DETECTABLE), gemini(cell(20, 40), null)]), '', { window: null });
    expect(screen.getByTestId('change_gemini_web')).toHaveTextContent('n/a');
    expect(screen.getByTestId('change_gemini_web').textContent).not.toMatch(/previous/i);
    expect(tipOf('change_gemini_web').textContent).toBe('');
  });

  it('is n/a without a reason while the counts have not loaded', () => {
    render(rowOf(undefined));
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('n/a');
    expect(screen.getByTestId('change_chatgpt_web').textContent).not.toMatch(/pts/);
    expect(tipOf('change_chatgpt_web').textContent).toBe('');
  });

  it('has no accessibility violation with changes, with gaps and with comparison off', async () => {
    const row = rowOf([chat(DETECTABLE), gemini(cell(20, 40), null)]);
    const on = render(row);
    expect(await axe(on.container)).toHaveNoViolations();
    on.unmount();
    const off = render(row, '?cmp=off');
    expect(await axe(off.container)).toHaveNoViolations();
  });
});

describe('sorting a change column', () => {
  /** Each row moved by different points on the two engines, so a column reads its own engine. */
  const ROWS: readonly PromptRow[] = [
    rowOf([chat(DETECTABLE), gemini(cell(12, 60), cell(30, 60))], 'chat-up-gemini-down'),
    rowOf([chat([DETECTABLE[1], DETECTABLE[0]]), gemini(cell(30, 60), cell(12, 60))], 'chat-down-gemini-up'),
    rowOf([chat([cell(24, 60), cell(12, 60)]), gemini(cell(24, 60), cell(12, 60))], 'both-small-up'),
    rowOf([engineOf('chatgpt_web', cell(30, 60), null), gemini(cell(30, 60), null)], 'no-previous'),
    rowOf(undefined, 'unloaded'),
  ];

  function Order({ desc }: { desc: boolean }): ReactElement {
    const columns = useChangeColumns(BOTH, 'mention', WINDOW);
    const rows = useSortedRows({
      rows: ROWS,
      columns,
      sort: [{ id: 'change_gemini_web', desc }],
      manual: false,
      getRowId: (row) => row.prompt.prompt_id,
    });
    return <output data-testid="order">{rows.map((row) => row.prompt.prompt_id).join(' ')}</output>;
  }

  it('orders by the points of its own engine, high first, and puts n/a last', () => {
    renderWithProviders(<Order desc />);
    expect(screen.getByTestId('order')).toHaveTextContent(
      'chat-down-gemini-up both-small-up chat-up-gemini-down no-previous unloaded',
    );
  });

  it('orders low first and still puts n/a last', () => {
    renderWithProviders(<Order desc={false} />);
    expect(screen.getByTestId('order')).toHaveTextContent(
      'chat-up-gemini-down both-small-up chat-down-gemini-up no-previous unloaded',
    );
  });

  it('has no sort value while comparison is off, so no stale order is kept', () => {
    function Values(): ReactElement {
      const columns = useChangeColumns(BOTH, 'mention', WINDOW);
      const [row] = ROWS;
      return (
        <output data-testid="values">
          {columns.map((column) => String(row === undefined ? 'missing' : column.sortValue?.(row))).join(' ')}
        </output>
      );
    }
    const off = renderWithProviders(<Values />, { searchParams: '?cmp=off' });
    expect(screen.getByTestId('values')).toHaveTextContent('null null');
    off.unmount();
    renderWithProviders(<Values />);
    expect(screen.getByTestId('values')).toHaveTextContent(/^0\.3\d* -0\.3\d*$/);
  });
});
