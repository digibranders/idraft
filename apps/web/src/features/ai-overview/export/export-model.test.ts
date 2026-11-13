import { describe, expect, it } from 'vitest';

import { buildAggregates, type AggregateInputs, type OverviewAggregates } from '../data/aggregates';
import type { OverviewScope } from '../scope/scope-model';
import {
  buildNumbersTable,
  exportFileName,
  NUMBERS_HEADER,
  numbersCsv,
  type ExportBlock,
  type NumbersTable,
} from './export-model';
import { cell, engine, projectEngine, promptRow } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineCode, EngineSummary, MetricCell, ProjectEngine, PromptsSummary, Schemas } from '@/lib/api/types';
import { toCsv, type CsvCell } from '@/lib/csv/csv-write';
import { NUMBER_TYPES } from '@/lib/layouts/catalog';

const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };
const PROJECT = { slug: 'fynix' };

const share = (numerator: number, denominator: number): MetricCell => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
  n_observations: denominator,
  pooled: null,
});

/** One engine of one prompt, with the named and cited outcome cell. */
function cellsOf(
  code: string,
  cells: { mentioned?: MetricCell; cited?: MetricCell; both?: MetricCell; share?: MetricCell },
): EngineSummary {
  const base = engine(code, {
    ...(cells.mentioned === undefined ? {} : { mentioned: cells.mentioned }),
    ...(cells.cited === undefined ? {} : { cited: cells.cited }),
    ...(cells.share === undefined ? {} : { share_of_voice: cells.share }),
  });
  return cells.both === undefined ? base : { ...base, outcomes: { ...base.outcomes, mentioned_and_cited: cells.both } };
}

function summaryOf(...prompts: ReturnType<typeof promptRow>[]): PromptsSummary {
  return {
    branded_only: false,
    engine_codes: ['chatgpt_web', 'gemini_web', 'google_ai_mode'],
    entities: [],
    entity_config_versions: [],
    include_branded: false,
    metric_context: {} as PromptsSummary['metric_context'],
    prompts,
    topics: [],
    window: WINDOW,
  };
}

function projectEngineOf(code: EngineCode, over: { enabled?: boolean; fanout?: boolean } = {}): ProjectEngine {
  const base = projectEngine(code);
  return {
    ...base,
    is_enabled: over.enabled ?? true,
    engine: { ...base.engine, exposes_fanout: over.fanout ?? false },
  };
}

const SOURCES: Schemas['SourcesMeta'] = {
  answers: 100,
  answers_citing: 90,
  by_role: [],
  by_role_by_engine: [
    {
      engine_code: 'chatgpt_web',
      own: { answers_citing: 10, citation_units: 10 },
      competitor: { answers_citing: 30, citation_units: 30 },
      third_party: { answers_citing: 60, citation_units: 60 },
    },
  ],
  citation_units: 100,
  engine_codes: ['chatgpt_web'],
  include_branded: false,
  window: WINDOW,
};

const FANOUT: Schemas['FanoutMeta'] = {
  answers: 600,
  answers_truncated: 0,
  answers_with_fanout: 96,
  engine_codes: ['chatgpt_web'],
  engines_without_fanout: ['gemini_web', 'google_ai_mode'],
  include_branded: false,
  min_support: 1,
  window: WINDOW,
};

/**
 * ChatGPT: Mentioned 4 of 12 valid answers over 2 prompts (15 answers seen), Cited 6 of 12, named and cited 2 of
 * 12, share of voice 3 of 8 naming answers. Gemini has 3 valid answers (too few), AI Mode has none.
 */
function worldInputs(over: Partial<AggregateInputs> = {}): AggregateInputs {
  const current = summaryOf(
    promptRow(
      'p1',
      'one',
      [],
      [
        cellsOf('chatgpt_web', {
          mentioned: { ...cell(3, 8), n_observations: 10 },
          cited: cell(2, 8),
          both: cell(1, 8),
          share: share(2, 4),
        }),
        cellsOf('gemini_web', { mentioned: cell(2, 3) }),
      ],
    ),
    promptRow(
      'p2',
      'two',
      [],
      [
        cellsOf('chatgpt_web', {
          mentioned: { ...cell(1, 4), n_observations: 5 },
          cited: cell(4, 4),
          both: cell(1, 4),
          share: share(1, 4),
        }),
      ],
    ),
  );
  return {
    current,
    previous: null,
    engines: [
      projectEngineOf('chatgpt_web', { fanout: true }),
      projectEngineOf('gemini_web'),
      projectEngineOf('google_ai_mode'),
    ],
    chosenEngines: null,
    topicsKept: null,
    sources: SOURCES,
    fanout: FANOUT,
    ...over,
  };
}

const world = (over: Partial<AggregateInputs> = {}): OverviewAggregates => buildAggregates(worldInputs(over));

function scopeOf(over: Partial<OverviewScope> = {}): OverviewScope {
  return {
    range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
    rangeValue: { kind: 'custom', from: '2026-10-16', to: '2026-11-12' },
    compare: true,
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    ...over,
  };
}

type Row = Record<string, CsvCell | undefined>;

/** The row of a number (and engine) as an object of its columns. */
function rowOf(table: NumbersTable, number: string, engineCode: string | null = null): Row {
  const index = (name: string): number => table.header.indexOf(name);
  const found = table.rows.find(
    (row) => row[index('number')] === number && (row[index('engine')] ?? null) === engineCode,
  );
  if (found === undefined) throw new Error(`No row for ${number} ${engineCode ?? ''}`);
  return Object.fromEntries(table.header.map((name, at) => [name, found[at]]));
}

const tableOf = (over: Partial<AggregateInputs> = {}, scope: OverviewScope = scopeOf()): NumbersTable =>
  buildNumbersTable(world(over), scope, PROJECT);

describe('the Numbers table', () => {
  it('has one flat header with the block, the value, its counts, the scope and the method', () => {
    expect(NUMBERS_HEADER).toEqual([
      'block',
      'project',
      'number',
      'engine',
      'value',
      'unit',
      'numerator',
      'denominator',
      'n_observations',
      'prompts',
      'status',
      'window_from',
      'window_to',
      'compare_from',
      'compare_to',
      'country',
      'topic',
      'branded',
      'method',
      'is_estimate',
    ]);
    const table = tableOf();
    expect(table.header).toEqual([...NUMBERS_HEADER]);
    for (const row of table.rows) expect(row).toHaveLength(NUMBERS_HEADER.length);
  });

  it('has a row for every number of the AI visibility catalog, a row for each engine of a per engine number', () => {
    const table = tableOf();
    const catalog = NUMBER_TYPES.filter((type) => type.screens.includes('ai_overview'));
    const expected = catalog.flatMap((type) =>
      type.perEngine
        ? ['chatgpt_web', 'gemini_web', 'google_ai_mode'].map((code) => `${type.metric}|${code}`)
        : [`${type.metric}|`],
    );
    const actual = table.rows.map((row) => `${String(row[2])}|${String(row[3] ?? '')}`);
    expect([...actual].sort()).toEqual([...expected].sort());
    // Prompts first, then each number for the engines in the catalog order
    expect(actual[0]).toBe('ai.prompts_in_scope|');
    expect(actual.slice(1, 4)).toEqual([
      'ai.valid_answers|chatgpt_web',
      'ai.valid_answers|gemini_web',
      'ai.valid_answers|google_ai_mode',
    ]);
  });

  it('writes a prompt weighted rate as a percent number with its counts, prompts and window', () => {
    expect(rowOf(tableOf(), 'ai.mention_rate', 'chatgpt_web')).toEqual({
      block: 'numbers',
      project: 'fynix',
      number: 'ai.mention_rate',
      engine: 'chatgpt_web',
      value: 31.25,
      unit: 'percent',
      numerator: 4,
      denominator: 12,
      n_observations: 15,
      prompts: 2,
      status: 'ok',
      window_from: '2026-10-16',
      window_to: '2026-11-12',
      compare_from: '2026-09-18',
      compare_to: '2026-10-15',
      country: 'all',
      topic: 'all',
      branded: 'excluded',
      method: 'prompt weighted',
      is_estimate: 'false',
    });
  });

  it('writes the other rates of an engine with the counts behind each', () => {
    const table = tableOf();
    expect(rowOf(table, 'ai.citation_rate', 'chatgpt_web')).toMatchObject({
      value: 62.5,
      numerator: 6,
      denominator: 12,
      prompts: 2,
      method: 'prompt weighted',
    });
    expect(rowOf(table, 'ai.mention_and_citation_rate', 'chatgpt_web')).toMatchObject({
      value: 18.75,
      numerator: 2,
      denominator: 12,
      method: 'prompt weighted',
    });
  });

  it('leaves the numerator of the share of voice empty: it is a sum of shares, not a count', () => {
    expect(rowOf(tableOf(), 'ai.share_of_voice', 'chatgpt_web')).toMatchObject({
      value: 37.5,
      numerator: null,
      denominator: 8,
      n_observations: 15,
      prompts: 2,
      status: 'ok',
    });
  });

  it('writes the counts as whole numbers: the prompts once, the valid answers of an engine of all its answers', () => {
    const table = tableOf();
    expect(rowOf(table, 'ai.prompts_in_scope')).toMatchObject({
      engine: null,
      value: 2,
      unit: 'count',
      numerator: null,
      denominator: null,
      prompts: 2,
      status: 'ok',
      method: 'count',
    });
    expect(rowOf(table, 'ai.valid_answers', 'chatgpt_web')).toMatchObject({
      value: 12,
      unit: 'count',
      numerator: 12,
      denominator: 15,
      n_observations: 15,
      status: 'ok',
      method: 'count',
    });
  });

  it('writes the citation share as own citation units of all of them, and the fan-out as answers with one', () => {
    const table = tableOf();
    expect(rowOf(table, 'ai.citation_share', 'chatgpt_web')).toMatchObject({
      value: 10,
      unit: 'percent',
      numerator: 10,
      denominator: 100,
      n_observations: null,
      prompts: null,
      status: 'ok',
      method: 'pooled',
    });
    expect(rowOf(table, 'ai.fanout_presence_rate', 'chatgpt_web')).toMatchObject({
      value: 16,
      numerator: 96,
      denominator: 600,
      n_observations: 600,
      status: 'ok',
      method: 'pooled',
    });
  });

  it('always says it is not an estimate', () => {
    for (const row of tableOf().rows) expect(row[NUMBERS_HEADER.indexOf('is_estimate')]).toBe('false');
  });

  it('writes the compare window only while the comparison is on, and the scope as it stands', () => {
    const off = rowOf(tableOf({}, scopeOf({ compare: false })), 'ai.mention_rate', 'chatgpt_web');
    expect(off).toMatchObject({ compare_from: null, compare_to: null });
    const scoped = rowOf(
      tableOf({}, scopeOf({ country: 'DE', topic: 'a1b2c3d4-0000-4000-8000-000000000001', branded: 'only' })),
      'ai.mention_rate',
      'chatgpt_web',
    );
    expect(scoped).toMatchObject({
      compare_from: '2026-09-18',
      country: 'DE',
      topic: 'a1b2c3d4-0000-4000-8000-000000000001',
      branded: 'only',
    });
  });

  it('treats a compare window before the first day as no comparison', () => {
    const early = scopeOf({ previous: { from: '1999-12-01', to: '1999-12-28' } });
    expect(rowOf(tableOf({}, early), 'ai.mention_rate', 'chatgpt_web')).toMatchObject({
      compare_from: null,
      compare_to: null,
    });
  });
});

describe('an unknown value', () => {
  const valueOf = (row: Row): CsvCell | undefined => row['value'];

  it('is an empty cell, never 0, with the reason in the status: too few answers keeps its counts', () => {
    const row = rowOf(tableOf(), 'ai.mention_rate', 'gemini_web');
    expect(valueOf(row)).toBeNull();
    expect(row).toMatchObject({ status: 'insufficient', numerator: 2, denominator: 3, prompts: 1 });
  });

  it('is an empty cell for an engine with no answer at all', () => {
    const row = rowOf(tableOf(), 'ai.mention_rate', 'google_ai_mode');
    expect(valueOf(row)).toBeNull();
    expect(row).toMatchObject({ status: 'no_answers', numerator: null });
    expect(valueOf(rowOf(tableOf(), 'ai.valid_answers', 'google_ai_mode'))).toBeNull();
  });

  it('is an empty cell for an engine that is off or left out of the filter, on every number of it', () => {
    const off = tableOf({
      engines: [
        projectEngineOf('chatgpt_web', { fanout: true }),
        projectEngineOf('gemini_web'),
        projectEngineOf('google_ai_mode', { enabled: false }),
      ],
    });
    const outside = tableOf({ chosenEngines: ['chatgpt_web', 'gemini_web'] });
    for (const row of off.rows.filter((entry) => entry[3] === 'google_ai_mode')) {
      expect(row[NUMBERS_HEADER.indexOf('value')]).toBeNull();
      expect(row[NUMBERS_HEADER.indexOf('status')]).toBe('off');
      expect(row[NUMBERS_HEADER.indexOf('numerator')]).toBeNull();
      expect(row[NUMBERS_HEADER.indexOf('denominator')]).toBeNull();
    }
    for (const row of outside.rows.filter((entry) => entry[3] === 'google_ai_mode')) {
      expect(row[NUMBERS_HEADER.indexOf('value')]).toBeNull();
      expect(row[NUMBERS_HEADER.indexOf('status')]).toBe('not_asked');
    }
  });

  it('is an empty cell for the fan-out of an engine that does not show it', () => {
    const row = rowOf(tableOf(), 'ai.fanout_presence_rate', 'gemini_web');
    expect(valueOf(row)).toBeNull();
    expect(row).toMatchObject({ status: 'not_exposed', numerator: null, denominator: null });
  });

  it('is an empty cell while a read is absent, never a zero', () => {
    const row = rowOf(tableOf({ sources: null, fanout: null }), 'ai.citation_share', 'chatgpt_web');
    expect(valueOf(row)).toBeNull();
    expect(row).toMatchObject({ status: 'unread', numerator: null, denominator: null });
    expect(
      valueOf(rowOf(tableOf({ sources: null, fanout: null }), 'ai.fanout_presence_rate', 'chatgpt_web')),
    ).toBeNull();
  });

  it('is empty on every number of the prompt rows when the summary carried none', () => {
    // `rowsRead` is false only for a summary that lists topic rows instead of prompts
    const current: PromptsSummary = {
      ...worldInputs().current,
      prompts: [],
      topics: [
        { term_id: 't1', name: 'One', prompt_count: 1, engines: [], last_observed_at: null, last_valid_at: null },
      ],
    };
    const unread = tableOf({ current });
    expect(rowOf(unread, 'ai.prompts_in_scope')).toMatchObject({ value: null, status: 'unread' });
    expect(rowOf(unread, 'ai.mention_rate', 'chatgpt_web')).toMatchObject({ value: null, status: 'unread' });
  });

  it('never writes 0 where the status is not ok, except a real count', () => {
    const table = tableOf();
    const value = NUMBERS_HEADER.indexOf('value');
    const status = NUMBERS_HEADER.indexOf('status');
    for (const row of table.rows) if (row[status] !== 'ok') expect(row[value]).toBeNull();
  });
});

describe('the cells of the file', () => {
  it('writes text so a spreadsheet does not read it as a formula (safeText)', () => {
    const table = tableOf({}, scopeOf({ topic: '=HYPERLINK("x")', country: '@home' }));
    const row = rowOf(table, 'ai.mention_rate', 'chatgpt_web');
    expect(row['topic']).toBe(`'=HYPERLINK("x")`);
    expect(row['country']).toBe("'@home");
    expect(toCsv({ header: table.header, rows: table.rows })).not.toMatch(/,=HYPERLINK/);
  });

  it('uses no en dash or em dash in the header, the words of the cells or the note', () => {
    const table = tableOf();
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    const words = [...table.header, table.note, ...table.rows.flat().filter((entry) => typeof entry === 'string')];
    for (const word of words) expect(String(word)).not.toMatch(dashes);
  });

  it('has a note that says an empty value is unknown and not zero', () => {
    expect(tableOf().note).toMatch(/empty/i);
    expect(tableOf().note).toMatch(/zero/i);
  });
});

describe('the file of the Numbers', () => {
  const block: ExportBlock = {
    id: 'ai.by_engine',
    header: ['engine', 'mentioned', 'label'],
    rows: [
      ['ChatGPT', 31.25, '=1+1'],
      ['Gemini', null, 'ok'],
    ],
  };

  it('is the numbers table alone, ending with its note, when no card has a block', () => {
    const aggregates = world();
    const table = buildNumbersTable(aggregates, scopeOf(), PROJECT);
    const file = numbersCsv(aggregates, scopeOf(), PROJECT);
    expect(file.header).toEqual(table.header);
    expect(file.rows.slice(0, table.rows.length)).toEqual(table.rows);
    expect(file.rows.slice(table.rows.length)).toEqual([[], ['note', table.note]]);
  });

  it('puts a block from a card after the strip block with a blank line, under its own header', () => {
    const aggregates = world();
    const strip = buildNumbersTable(aggregates, scopeOf(), PROJECT).rows;
    const file = numbersCsv(aggregates, scopeOf(), PROJECT, { blocks: [block] });
    expect(file.rows[strip.length]).toEqual([]);
    expect(file.rows[strip.length + 1]).toEqual(['block', 'engine', 'mentioned', 'label']);
    expect(file.rows[strip.length + 2]).toEqual(['ai.by_engine', 'ChatGPT', 31.25, "'=1+1"]);
    expect(file.rows[strip.length + 3]).toEqual(['ai.by_engine', 'Gemini', null, 'ok']);
    const text = toCsv(file);
    expect(text).toContain('\r\n\r\nblock,engine,mentioned,label\r\n');
  });

  it('keeps blocks in the order given, each after a blank line, and ends with the extra notes', () => {
    const aggregates = world();
    const second: ExportBlock = { id: 'ai.zzz', header: ['x'], rows: [[1]] };
    const file = numbersCsv(aggregates, scopeOf(), PROJECT, {
      blocks: [block, second],
      notes: ['1 blocks were still loading and are not included'],
    });
    const blank = file.rows.flatMap((row, at) => (row.length === 0 ? [at] : []));
    expect(blank).toHaveLength(3);
    const secondBlank = blank[1] ?? -1;
    expect(file.rows.slice(secondBlank + 1, secondBlank + 3)).toEqual([
      ['block', 'x'],
      ['ai.zzz', 1],
    ]);
    expect(file.rows.at(-2)).toEqual(['note', expect.stringContaining('Rates are')]);
    expect(file.rows.at(-1)).toEqual(['note', '1 blocks were still loading and are not included']);
  });
});

describe('the file name', () => {
  it('carries the project and the window', () => {
    expect(exportFileName(PROJECT, scopeOf())).toBe('ai-overview-fynix-2026-10-16-to-2026-11-12.csv');
  });
});
