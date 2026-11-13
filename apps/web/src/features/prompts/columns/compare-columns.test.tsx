import { screen, within } from '@testing-library/react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { compareColumns } from './compare-columns';
import { DETECTABLE, WITHIN, cell, engineOf, projectEngine } from '../compare/change-test-data';
import { ComparedWindowProvider, type ComparedWindow } from '../compare/compared-window';
import type { PromptRow } from '../prompt-columns';
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

/** The columns the entry builds, with the translator and locale the screen gives it. */
function useBuilt(engines: readonly ProjectEngine[], metric: RateMetric): readonly DataTableColumn<PromptRow>[] {
  const t = useTranslations();
  const locale = useLocale();
  return compareColumns.build({ engines, metric, t, locale });
}

/** Every change column of a row as the table draws its cell. */
function Cells({
  row,
  engines,
  metric,
}: {
  row: PromptRow;
  engines: ProjectEngine[];
  metric: RateMetric;
}): ReactElement {
  const columns = useBuilt(engines, metric);
  return (
    <>
      {columns.map((column) => (
        <div key={column.id} data-testid={column.id}>
          {column.cell(row)}
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
    <ComparedWindowProvider value={options.window === undefined ? WINDOW : options.window}>
      <Cells row={row} engines={options.engines ?? BOTH} metric={options.metric ?? 'mention'} />
    </ComparedWindowProvider>,
    { searchParams },
  );

/** The element of a cell that holds its tooltip: the first one inside the cell. */
const tipHolder = (id: string): HTMLElement => {
  const holder = screen.getByTestId(id).firstElementChild;
  if (!(holder instanceof HTMLElement)) throw new Error(`The cell ${id} draws nothing`);
  return holder;
};

describe('the change columns of the Prompts tab', () => {
  it('is an entry of the seam, so the table lists its columns', () => {
    expect(PROMPT_COLUMN_ENTRIES).toContain(compareColumns);
  });

  it('builds one column per engine shown, hidden by default, with its own unique ids', () => {
    function Ids(): ReactElement {
      const columns = useBuilt(BOTH, 'mention');
      return (
        <output data-testid="ids">
          {columns.map((column) => `${column.id}:${String(column.defaultVisible)}:${column.type}`).join(' ')}
        </output>
      );
    }
    renderWithProviders(<Ids />);
    expect(screen.getByTestId('ids')).toHaveTextContent(
      'change_chatgpt_web:false:volumeTrend change_gemini_web:false:volumeTrend',
    );
  });

  it('is headed by the engine and says in its tooltip which metric of the page it follows', () => {
    function Headers(): ReactElement {
      const columns = useBuilt(BOTH, 'citation');
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
    renderWithProviders(<Headers />);
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('ChatGPT change|');
    expect(screen.getByTestId('change_gemini_web')).toHaveTextContent('Gemini change|');
    expect(screen.getByTestId('change_gemini_web')).toHaveTextContent(
      "Change in points of this engine's Citation since the previous period. Coloured only when the change is detectable.",
    );
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

  it('has the previous value with its answers, the window and the verdict in the tooltip', () => {
    render(rowOf([chat(DETECTABLE), gemini(WITHIN[0], WITHIN[1])]));
    const holder = tipHolder('change_chatgpt_web');
    expect(holder).toHaveAccessibleDescription(/Previous 20%, 12 of 60 answers/);
    expect(holder).toHaveAccessibleDescription(/Previous period: Sep 18 to Oct 15/);
    expect(holder).toHaveAccessibleDescription(/Detectable change/);
    expect(holder).toHaveAccessibleDescription(/Interim test: unpaired/);
    expect(tipHolder('change_gemini_web')).toHaveAccessibleDescription(/Within normal variation/);
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
    expect(tipHolder('change_chatgpt_web')).toHaveAccessibleDescription(/No test exists for share of voice/);
  });

  it('is n/a with Comparison is off while comparison is off, and draws no change', () => {
    render(rowOf([chat(DETECTABLE), gemini(WITHIN[0], WITHIN[1])]), '?cmp=off');
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('n/a');
    expect(screen.getByTestId('change_chatgpt_web').textContent).not.toMatch(/pts/);
    expect(tipHolder('change_chatgpt_web')).toHaveAccessibleDescription('Comparison is off');
  });

  it('says No answers in the previous period for an engine that has none, never 0', () => {
    render(rowOf([chat(DETECTABLE), gemini(cell(20, 40), null)]));
    expect(screen.getByTestId('change_gemini_web')).toHaveTextContent('n/a');
    expect(screen.getByTestId('change_gemini_web').textContent).not.toMatch(/0\.0|pts/);
    expect(tipHolder('change_gemini_web')).toHaveAccessibleDescription('No answers in the previous period');
  });

  it('says there are too few answers when the previous period gives no rate', () => {
    render(rowOf([chat([cell(30, 60), cell(2, 3)]), gemini(WITHIN[0], WITHIN[1])]));
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('n/a');
    expect(tipHolder('change_chatgpt_web')).toHaveAccessibleDescription(
      'Too few answers in one of the periods for a rate',
    );
  });

  it('says nothing about the previous period while the held read was not compared', () => {
    render(rowOf([chat(DETECTABLE), gemini(cell(20, 40), null)]), '', { window: null });
    expect(screen.getByTestId('change_gemini_web')).toHaveTextContent('n/a');
    expect(screen.getByTestId('change_gemini_web').textContent).not.toMatch(/previous/i);
    expect(tipHolder('change_gemini_web')).not.toHaveAccessibleDescription(/previous period/i);
  });

  it('is n/a without a reason while the counts have not loaded', () => {
    render(rowOf(undefined));
    expect(screen.getByTestId('change_chatgpt_web')).toHaveTextContent('n/a');
    expect(screen.getByTestId('change_chatgpt_web').textContent).not.toMatch(/pts/);
    expect(tipHolder('change_chatgpt_web')).not.toHaveAccessibleDescription(/previous|answers/i);
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
  const ROWS: readonly PromptRow[] = [
    rowOf([chat([cell(24, 60), cell(12, 60)])], 'small'),
    rowOf([chat([cell(12, 60), cell(30, 60)])], 'fell'),
    rowOf([engineOf('chatgpt_web', cell(30, 60), null)], 'none'),
    rowOf([chat(DETECTABLE)], 'rose'),
    rowOf(undefined, 'unloaded'),
  ];

  function Order({ desc }: { desc: boolean }): ReactElement {
    const columns = useBuilt(CHAT_ONLY, 'mention');
    const rows = useSortedRows({
      rows: ROWS,
      columns,
      sort: [{ id: 'change_chatgpt_web', desc }],
      manual: false,
      getRowId: (row) => row.prompt.prompt_id,
    });
    return <output data-testid="order">{rows.map((row) => row.prompt.prompt_id).join(' ')}</output>;
  }

  it('orders by the points, high first, and puts n/a last', () => {
    renderWithProviders(<Order desc />);
    expect(screen.getByTestId('order')).toHaveTextContent('rose small fell none unloaded');
  });

  it('orders low first and still puts n/a last', () => {
    renderWithProviders(<Order desc={false} />);
    expect(screen.getByTestId('order')).toHaveTextContent('fell small rose none unloaded');
  });
});
