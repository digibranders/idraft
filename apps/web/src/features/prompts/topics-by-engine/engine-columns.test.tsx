import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { cell, competitor, engine, entityCells, own, pool, week, weighted } from './cells-fixtures';
import { useByEngineColumns } from './engine-columns';
import type { EntityRead } from './topic-entities-query';
import type { RateMetric } from '@/features/prompts/prompt-model';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { EngineSummary, ProjectEngine, TopicSummaryRow } from '@/lib/api/types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { renderWithProviders } from '@/test/render';

interface Row {
  /** `null` for a prompt row. */
  key: string | null;
  name: string;
  cells: readonly EngineSummary[] | undefined;
}

const cellsOf = (row: Row): readonly EngineSummary[] | undefined => row.cells;
const topicOf = (row: Row): { key: string; name: string } | null =>
  row.key === null ? null : { key: row.key, name: row.name };

const engineOf = (code: 'chatgpt_web' | 'gemini_web' | 'google_ai_mode'): ProjectEngine => ({
  active_prompts: 1,
  engine: ENGINE_FACTS[code],
  estimated_monthly_cost_usd: null,
  is_configured: true,
  is_enabled: true,
  location_ids: [2276],
  provider_code: 'openai',
  replicates: 1,
});
const ENGINES = [engineOf('chatgpt_web'), engineOf('gemini_web'), engineOf('google_ai_mode')];

const NO_ENTITIES: EntityRead = {
  status: 'loading',
  rows: new Map(),
  tracked: [],
  fetching: false,
  retry: () => undefined,
};

const topic = (key: string, name: string, cells: readonly EngineSummary[]): Row => ({ key, name, cells });
/** ChatGPT 3 of 8, Gemini 6 of 8, AI Mode 2 of 3 (too few answers): gap 37.5 points over 2 engines. */
const MIXED = topic('t1', 'Technical SEO', [
  engine('chatgpt_web', { mentioned: weighted(3, 8, 2), cited: weighted(1, 8, 2) }),
  engine('gemini_web', { mentioned: weighted(6, 8, 2), cited: weighted(4, 8, 2) }),
  engine('google_ai_mode', { mentioned: weighted(2, 3, 2) }),
]);

interface HarnessProps {
  rows: readonly Row[];
  metric?: RateMetric;
  entities?: EntityRead;
  engines?: readonly ProjectEngine[];
  onDrill?: (topicKey: string, engineCode: string) => void;
  onColumns?: (columns: DataTableColumn<Row>[]) => void;
}

/** Every cell of the columns, drawn in a plain table: the cell of each row and column carries the id of the column. */
function Harness({
  rows,
  metric = 'mention',
  entities = NO_ENTITIES,
  engines = ENGINES,
  onDrill = () => undefined,
  onColumns,
}: HarnessProps) {
  const columns = useByEngineColumns<Row>({ engines, cellsOf, topicOf, entities, metric, onDrill });
  onColumns?.(columns);
  return (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} aria-label={row.name}>
            {columns.map((column) => (
              <td key={column.id} data-column={column.id}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The columns alone: nothing is drawn, so a test may read a column's tip beside the cells it drew. */
function ColumnsOnly({
  metric = 'mention',
  entities = NO_ENTITIES,
  engines = ENGINES,
  onDrill = () => undefined,
  onColumns,
}: HarnessProps) {
  const columns = useByEngineColumns<Row>({ engines, cellsOf, topicOf, entities, metric, onDrill });
  onColumns?.(columns);
  return null;
}

function columnsOf(props: HarnessProps): DataTableColumn<Row>[] {
  let seen: DataTableColumn<Row>[] = [];
  renderWithProviders(
    <ColumnsOnly
      {...props}
      onColumns={(columns) => {
        seen = columns;
      }}
    />,
  );
  return seen;
}
const byId = (columns: readonly DataTableColumn<Row>[], id: string): DataTableColumn<Row> => {
  const found = columns.find((column) => column.id === id);
  if (found === undefined) throw new Error(`No column ${id}`);
  return found;
};
const cellIn = (rowName: string, id: string): HTMLElement => {
  const found = within(screen.getByRole('row', { name: rowName }))
    .getAllByRole('cell')
    .find((td) => td.getAttribute('data-column') === id);
  if (found === undefined) throw new Error(`No cell ${id}`);
  return found;
};
const tipOf = (columns: readonly DataTableColumn<Row>[], id: string, row: Row): string => {
  const tip = byId(columns, id).cellTip?.(row);
  return tip === undefined ? '' : [tip.content, tip.detail].filter(Boolean).join(' | ');
};

describe('useByEngineColumns: the rate columns', () => {
  it('shows one rate column per engine for the chosen metric with its percent and its count', () => {
    renderWithProviders(<Harness rows={[MIXED]} />);
    expect(cellIn('Technical SEO', 'chatgpt_web_rate')).toHaveTextContent('38%');
    expect(cellIn('Technical SEO', 'chatgpt_web_rate')).toHaveTextContent('3 of 8');
    expect(cellIn('Technical SEO', 'gemini_web_rate')).toHaveTextContent('75%');
    expect(cellIn('Technical SEO', 'gemini_web_rate')).toHaveTextContent('6 of 8');
  });

  it('reads the cell of the chosen metric', () => {
    const columns = columnsOf({ rows: [MIXED], metric: 'citation' });
    expect(byId(columns, 'chatgpt_web_rate').header).toBe('ChatGPT citation');
    expect(byId(columns, 'chatgpt_web_rate').sortValue?.(MIXED)).toBeCloseTo(0.125, 9);
  });

  it('shows the insufficient pill under 4 answers and n/a with none', () => {
    const row = topic('t2', 'No answers here', [
      engine('chatgpt_web', { mentioned: weighted(1, 3, 2) }),
      engine('gemini_web'),
    ]);
    renderWithProviders(<Harness rows={[row]} />);
    expect(cellIn('No answers here', 'chatgpt_web_rate')).toHaveTextContent('3 answers');
    expect(cellIn('No answers here', 'chatgpt_web_rate')).not.toHaveTextContent('%');
    expect(cellIn('No answers here', 'gemini_web_rate')).toHaveTextContent('No answers');
    expect(cellIn('No answers here', 'google_ai_mode_rate')).toHaveTextContent('No answers');
  });

  it('sorts by an engine rate, a row without one last in both directions', () => {
    const columns = columnsOf({ rows: [] });
    const sorted = byId(columns, 'gemini_web_rate').sortValue;
    const thin = topic('t3', 'Thin', [engine('gemini_web', { mentioned: weighted(1, 3, 2) })]);
    const none = topic('t4', 'None', []);
    expect(sorted?.(MIXED)).toBe(0.75);
    // A rate over too few answers sorts with the rows that have none, and none is null, never 0
    expect(sorted?.(thin)).toBeNull();
    expect(sorted?.(none)).toBeNull();
  });

  it('a topic engine cell is a button that opens the drawer on Prompts with that engine', async () => {
    const onDrill = vi.fn();
    const { user } = renderWithProviders(<Harness rows={[MIXED]} onDrill={onDrill} />);
    const button = within(cellIn('Technical SEO', 'gemini_web_rate')).getByRole('button', {
      name: 'Open the prompts of Technical SEO on Gemini',
    });
    await user.click(button);
    expect(onDrill).toHaveBeenCalledWith('t1', 'gemini_web');
  });

  it('names the value of a drill cell for the table, whatever the button is called', () => {
    const columns = columnsOf({ rows: [MIXED] });
    expect(byId(columns, 'gemini_web_rate').cellLabel?.(MIXED)).toBe('75%, 6 of 8 answers');
  });

  it('a prompt row engine cell is plain text', () => {
    const prompt: Row = { key: null, name: 'A prompt', cells: [engine('chatgpt_web', { mentioned: cell(3, 4) })] };
    renderWithProviders(<Harness rows={[prompt]} />);
    expect(cellIn('A prompt', 'chatgpt_web_rate')).toHaveTextContent('75%');
    expect(within(cellIn('A prompt', 'chatgpt_web_rate')).queryByRole('button')).toBeNull();
  });

  it('a cell with no answer is no button', () => {
    renderWithProviders(<Harness rows={[topic('t5', 'Empty', [engine('chatgpt_web')])]} />);
    expect(within(cellIn('Empty', 'chatgpt_web_rate')).queryByRole('button')).toBeNull();
  });
});

describe('useByEngineColumns: the gap column', () => {
  it('sorts by the engine gap, a row under 2 engines with a rate last', () => {
    const columns = columnsOf({ rows: [] });
    const gap = byId(columns, 'engine_gap');
    expect(gap.sortValue?.(MIXED)).toBeCloseTo(37.5, 9);
    expect(
      gap.sortValue?.(topic('t6', 'One engine', [engine('chatgpt_web', { mentioned: weighted(3, 8, 2) })])),
    ).toBeNull();
  });

  it('shows the exact gap in points with one decimal', () => {
    renderWithProviders(<Harness rows={[MIXED]} />);
    expect(cellIn('Technical SEO', 'engine_gap')).toHaveTextContent('37.5 pts');
  });

  it('the gap cell says best and weakest with rates and counts and names the engines left out', () => {
    const columns = columnsOf({ rows: [] });
    const text = tipOf(columns, 'engine_gap', MIXED);
    expect(text).toContain('Gemini 75% against ChatGPT 38%, over 2 engines.');
    expect(text).toContain('ChatGPT 3 of 8');
    expect(text).toContain('Gemini 6 of 8');
    expect(text).toContain('Left out for too few answers: Google AI Mode.');
  });

  it('the gap is n/a under 2 engines with a rate, and says why', () => {
    const one = topic('t6', 'One engine', [engine('chatgpt_web', { mentioned: weighted(3, 8, 2) })]);
    renderWithProviders(<Harness rows={[one]} />);
    expect(cellIn('One engine', 'engine_gap')).toHaveTextContent('n/a');
    expect(tipOf(columnsOf({ rows: [] }), 'engine_gap', one)).toBe('A gap needs a rate on at least 2 engines.');
  });
});

describe('useByEngineColumns: the columns of the chooser', () => {
  it('waits with the count, trend and leader columns in the chooser, the rates and the gap shown', () => {
    const columns = columnsOf({ rows: [] });
    const shown = columns.filter((column) => column.defaultVisible !== false).map((column) => column.id);
    expect(shown).toEqual(['chatgpt_web_rate', 'gemini_web_rate', 'google_ai_mode_rate', 'engine_gap']);
    const waiting = columns.filter((column) => column.defaultVisible === false).map((column) => column.id);
    expect(waiting).toEqual([
      'chatgpt_web_mentioned',
      'chatgpt_web_cited',
      'gemini_web_mentioned',
      'gemini_web_cited',
      'google_ai_mode_mentioned',
      'google_ai_mode_cited',
      'trend_chatgpt_web',
      'trend_gemini_web',
      'trend_google_ai_mode',
      'leader_chatgpt_web',
      'leader_gemini_web',
      'leader_google_ai_mode',
    ]);
  });

  it('draws a trend line per engine and says how many points are pooled with the C-18 sentence', () => {
    const POOL = pool(4, '2026-10-05', '2026-11-01');
    const weeks = [
      week('2026-10-19', { mentioned: weighted(2, 8, 2), prompts: 2 }),
      week('2026-10-26', { mentioned: weighted(3, 8, 2), prompts: 2, pool: POOL }),
      week('2026-11-02', { mentioned: weighted(4, 8, 2), prompts: 2, pool: POOL }),
    ];
    const row = topic('t7', 'Trended', [engine('chatgpt_web', { mentioned: weighted(9, 24, 2), series: weeks })]);
    renderWithProviders(<Harness rows={[row]} />);
    const trend = cellIn('Trended', 'trend_chatgpt_web');
    expect(
      within(trend).getByRole('img', { name: 'Mention on ChatGPT by week: 25%, 38%, and 50%' }),
    ).toBeInTheDocument();
    const tip = tipOf(columnsOf({ rows: [] }), 'trend_chatgpt_web', row);
    expect(tip).toContain('2 of 3 weekly points show several weeks together.');
    expect(tip).toContain(
      'A topic point with fewer than 10 prompts answering that week shows the last 4 weeks together',
    );
  });

  it('draws no line for an engine without a series, and never a zero', () => {
    renderWithProviders(<Harness rows={[MIXED]} />);
    expect(within(cellIn('Technical SEO', 'trend_chatgpt_web')).queryByRole('img')).toBeNull();
  });

  it('shows the leader with share and count in the leader columns', () => {
    const tracked = [own('e-own'), competitor('e-b', 'Brightly'), competitor('e-c', 'Corvid')];
    const entityRow = (code: string): EngineSummary =>
      engine(code, {
        share_of_voice: cell(0, 20),
        entities: [
          entityCells('e-own', cell(4, 10), cell(0, 20)),
          entityCells('e-b', cell(5, 10), { ...cell(0, 20), value: 0.4 }),
          entityCells('e-c', cell(2, 10), { ...cell(0, 20), value: 0.1 }),
        ],
      });
    const entities: EntityRead = {
      status: 'ready',
      rows: new Map([
        [
          't1',
          {
            term_id: 't1',
            name: 'Technical SEO',
            prompt_count: 2,
            engines: [entityRow('chatgpt_web')],
          } as TopicSummaryRow,
        ],
      ]),
      tracked,
      fetching: false,
      retry: () => undefined,
    };
    renderWithProviders(<Harness rows={[MIXED]} entities={entities} />);
    expect(cellIn('Technical SEO', 'leader_chatgpt_web')).toHaveTextContent('Brightly 40%');
    const tip = tipOf(columnsOf({ rows: [], entities }), 'leader_chatgpt_web', MIXED);
    expect(tip).toContain('Brightly: 40% share of voice on ChatGPT, 20 answers naming a brand.');
    // The engine rate cell of the same engine gains the sentence beside its own
    expect(tipOf(columnsOf({ rows: [], entities }), 'chatgpt_web_rate', MIXED)).toContain(
      'Brightly: 40% share of voice',
    );
  });

  it('says None named, too few, or nothing while loading', () => {
    const tracked = [own('e-own'), competitor('e-b', 'Brightly')];
    const quiet = (answers: number): EngineSummary =>
      engine('chatgpt_web', {
        share_of_voice: cell(0, answers),
        entities: [
          entityCells('e-own', cell(0, 10), cell(0, answers)),
          entityCells('e-b', cell(0, 10), cell(0, answers)),
        ],
      });
    const rowsOf = (engineSummary: EngineSummary): EntityRead => ({
      status: 'ready',
      rows: new Map([
        ['t1', { term_id: 't1', name: 'Technical SEO', prompt_count: 2, engines: [engineSummary] } as TopicSummaryRow],
      ]),
      tracked,
      fetching: false,
      retry: () => undefined,
    });
    const named = rowsOf(quiet(12));
    renderWithProviders(<Harness rows={[MIXED]} entities={named} />);
    expect(cellIn('Technical SEO', 'leader_chatgpt_web')).toHaveTextContent('None named');
    expect(tipOf(columnsOf({ rows: [], entities: named }), 'leader_chatgpt_web', MIXED)).toContain(
      'No tracked competitor is named in the answers of this topic on ChatGPT.',
    );
    const few = rowsOf(quiet(2));
    expect(tipOf(columnsOf({ rows: [], entities: few }), 'leader_chatgpt_web', MIXED)).toContain(
      'Too few answers that name a tracked brand on ChatGPT: 2 of the 4 it needs.',
    );
    expect(tipOf(columnsOf({ rows: [], entities: NO_ENTITIES }), 'leader_chatgpt_web', MIXED)).toBe(
      'Competitors are loading.',
    );
  });

  it('leaves the leader of a prompt row blank', () => {
    const prompt: Row = { key: null, name: 'A prompt', cells: [engine('chatgpt_web', { mentioned: cell(3, 4) })] };
    renderWithProviders(<Harness rows={[prompt]} />);
    expect(cellIn('A prompt', 'leader_chatgpt_web')).toHaveTextContent('n/a');
  });
});

describe('useByEngineColumns: unknown is never zero', () => {
  it('writes no 0 for a row whose cells are not loaded', () => {
    const unloaded: Row = { key: 't9', name: 'Unloaded', cells: undefined };
    renderWithProviders(<Harness rows={[unloaded]} />);
    const row = screen.getByRole('row', { name: 'Unloaded' });
    expect(row.textContent).not.toMatch(/\b0\b|0%/);
    expect(cellIn('Unloaded', 'chatgpt_web_rate')).toHaveTextContent('n/a');
    expect(cellIn('Unloaded', 'engine_gap')).toHaveTextContent('n/a');
  });
});
