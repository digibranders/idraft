import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv/csv-write';

import {
  DIVERGING_BINS,
  RATE_BIN_EDGES,
  SEQUENTIAL_BINS,
  cellUnder,
  divergingBin,
  heatmapCsv,
  sequentialBin,
  type HeatCsvRow,
} from './heat-bins';

const SRC_ROOT = path.join(import.meta.dirname, '../../..');

describe('sequentialBin', () => {
  it('puts each edge in the upper bin, on the whole percent that is printed', () => {
    // [rate, bin number, the percent the cell prints]
    const cases: readonly (readonly [number, number, number])[] = [
      [0, 1, 0],
      [0.0049, 1, 0],
      [0.05, 2, 5],
      [0.0996, 3, 10],
      [0.1, 3, 10],
      [0.199, 4, 20],
      [0.35, 5, 35],
      [0.5, 6, 50],
      [0.7, 7, 70],
      [1, 7, 100],
    ];
    for (const [rate, bin, printed] of cases) {
      expect(Math.round(rate * 100), `printed percent of ${rate}`).toBe(printed);
      expect(sequentialBin(rate).fill, `bin of ${rate}`).toBe(`bg-seq-${bin}`);
    }
  });

  it('has seven bins and five edges between the lowest and the highest', () => {
    expect(SEQUENTIAL_BINS).toHaveLength(7);
    expect(RATE_BIN_EDGES).toEqual([0.1, 0.2, 0.35, 0.5, 0.7]);
    expect(new Set(SEQUENTIAL_BINS.map((bin) => bin.key)).size).toBe(7);
  });

  it('refuses a value that is not a rate', () => {
    for (const rate of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      expect(() => sequentialBin(rate)).toThrow(RangeError);
    }
  });

  it('follows the measured text colour pairs', () => {
    expect(SEQUENTIAL_BINS.slice(0, 5).map((bin) => bin.text.split(' ')[0])).toEqual(Array(5).fill('text-foreground'));
    expect(SEQUENTIAL_BINS.slice(5).map((bin) => bin.text)).toEqual(Array(2).fill('text-foreground-inverse'));
    // Dark seq-5 is the one bin whose text flips with the theme
    expect(SEQUENTIAL_BINS[4]?.text).toBe('text-foreground dark:text-foreground-inverse');
    expect(SEQUENTIAL_BINS.slice(0, 4).every((bin) => !bin.text.includes('dark:'))).toBe(true);
  });
});

describe('divergingBin', () => {
  it('is neutral unless the change is detectable', () => {
    expect(divergingBin(20, false).fill).toBe('bg-div-zero');
    expect(divergingBin(20, null).fill).toBe('bg-div-zero');
    expect(divergingBin(-20, false).fill).toBe('bg-div-zero');
    expect(divergingBin(20, true).fill).toBe('bg-div-pos-3');
    expect(divergingBin(-6, true).fill).toBe('bg-div-neg-2');
  });

  it('is neutral when the printed size is 0, as when the change is exactly 0', () => {
    expect(divergingBin(0.04, true).fill).toBe('bg-div-zero');
    expect(divergingBin(-0.04, true).fill).toBe('bg-div-zero');
    expect(divergingBin(0.05, true).fill).toBe('bg-div-pos-1');
  });

  it('bins a detectable change by its size in points, per side', () => {
    expect(divergingBin(2.1, true).fill).toBe('bg-div-pos-1');
    expect(divergingBin(5, true).fill).toBe('bg-div-pos-2');
    expect(divergingBin(14.9, true).fill).toBe('bg-div-pos-2');
    expect(divergingBin(15, true).fill).toBe('bg-div-pos-3');
    expect(divergingBin(-2.1, true).fill).toBe('bg-div-neg-1');
    expect(divergingBin(-15, true).fill).toBe('bg-div-neg-3');
  });

  it('has seven bins from the largest fall to the largest rise', () => {
    expect(DIVERGING_BINS.map((bin) => bin.fill)).toEqual([
      'bg-div-neg-3',
      'bg-div-neg-2',
      'bg-div-neg-1',
      'bg-div-zero',
      'bg-div-pos-1',
      'bg-div-pos-2',
      'bg-div-pos-3',
    ]);
  });

  it('refuses a change that is not a number', () => {
    expect(() => divergingBin(Number.NaN, true)).toThrow(RangeError);
  });
});

describe('one bin function', () => {
  /** Every ts and tsx file under src that is not a test, as [path from src, text]. */
  function sources(): readonly (readonly [string, string])[] {
    return readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' })
      .map((file) => file.split(path.sep).join('/'))
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => [file, readFileSync(path.join(SRC_ROOT, file), 'utf8')] as const);
  }

  // The utility form (bg-seq-3) and the variable shorthand (bg-(--seq-3)) of a sequential or diverging fill
  const FILL_CLASS = /bg-(?:seq|div)-|bg-\(--(?:seq|div)-/;

  // Files that use the sequential steps as a plain palette (a named key to a colour), never to bin a rate.
  // BarList draws its distribution mode (CH-18) with seq-1 to seq-7 by name. Add a file here only for that.
  const PALETTE_USERS: readonly string[] = ['components/app/chart/bar-list.tsx'];

  // Limits: scans non-test .ts and .tsx under src, and only the bg-seq-, bg-div-, bg-(--seq- and bg-(--div- forms.
  it('finds seq and div fill class strings only in heat-bins.ts and the listed palette users', () => {
    const files = sources();
    expect(files.map(([file]) => file)).toContain('components/app/chart/heat-bins.ts');
    const offenders = files
      .filter(([file, text]) => !PALETTE_USERS.includes(file) && FILL_CLASS.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual(['components/app/chart/heat-bins.ts']);
  });
});

const ROWS: readonly HeatCsvRow[] = [
  {
    label: 'CRM',
    prompts: '17',
    cells: [
      { state: 'ok', tip: 'CRM on ChatGPT: 47%, 64 of 136 answers' },
      { state: 'insufficient', tip: 'CRM on Gemini: 3 answers, fewer than 4' },
      { state: 'none', tip: 'CRM on Claude: no answers' },
    ],
    children: [
      {
        label: 'Startups',
        prompts: '5',
        cells: [
          { state: 'ok', tip: 'Startups on ChatGPT: 20%, 4 of 20 answers' },
          { state: 'none', tip: 'x' },
          { state: 'none', tip: 'x' },
        ],
      },
    ],
  },
];

describe('cellUnder', () => {
  it('returns the cell of a column, and throws for a row that is short of one', () => {
    expect(cellUnder(['a', 'b'], 1, 'CRM')).toBe('b');
    expect(() => cellUnder(['a'], 1, 'CRM')).toThrow(RangeError);
  });
});

describe('heatmapCsv', () => {
  const table = heatmapCsv({
    rowHeader: 'Topic',
    promptsHeader: 'Prompts',
    noneText: 'n/a',
    columns: ['ChatGPT', 'Gemini', 'Claude'],
    rows: ROWS,
  });

  it('writes counts, never a zero for unknown', () => {
    expect(table.header).toEqual(['Topic', 'Prompts', 'ChatGPT', 'Gemini', 'Claude']);
    // A rate with its counts, an insufficient cell with its tip words, a cell without answers as n/a
    expect(table.rows[0]).toEqual([
      'CRM',
      '17',
      'CRM on ChatGPT: 47%, 64 of 136 answers',
      'CRM on Gemini: 3 answers, fewer than 4',
      'n/a',
    ]);
    expect(table.rows.flat()).not.toContain(0);
    expect(table.rows.flat()).not.toContain('0%');
  });

  it('writes the rows of an open tree after their parent, named by the path', () => {
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]?.[0]).toBe('CRM / Startups');
    expect(table.rows[1]?.[2]).toBe('Startups on ChatGPT: 20%, 4 of 20 answers');
  });

  it('leaves out the Prompts column when no header is given', () => {
    const without = heatmapCsv({
      rowHeader: 'Topic',
      noneText: 'n/a',
      columns: ['ChatGPT', 'Gemini', 'Claude'],
      rows: ROWS,
    });
    expect(without.header).toEqual(['Topic', 'ChatGPT', 'Gemini', 'Claude']);
    expect(without.rows[0]).toHaveLength(4);
  });

  it('writes text a spreadsheet would read as a formula as plain text', () => {
    const risky = heatmapCsv({
      rowHeader: 'Topic',
      noneText: 'n/a',
      columns: ['Change'],
      rows: [{ label: '=SUM(A1)', cells: [{ state: 'ok', tip: '+2.1 pts, 4 of 20 answers' }] }],
    });
    expect(risky.rows[0]).toEqual(["'=SUM(A1)", "'+2.1 pts, 4 of 20 answers"]);
    expect(toCsv(risky)).toContain("'=SUM(A1)");
  });

  it('refuses a row with a cell missing for a column', () => {
    expect(() =>
      heatmapCsv({ rowHeader: 'Topic', noneText: 'n/a', columns: ['A', 'B'], rows: [{ label: 'x', cells: [] }] }),
    ).toThrow(RangeError);
  });
});
