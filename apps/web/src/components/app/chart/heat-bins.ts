/**
 * The one bin function of every rate heat-map (D-05, inventory CH-04): a fixed scale of seven bins, so the
 * same colour means the same rate on every page. Pure, no React. Fill classes are written out in full so
 * Tailwind sees them; `heat-bins.test.ts` fails when a second table of them appears elsewhere in `src`, and
 * `heat-bins.contrast.test.ts` measures every text and fill pair in both themes.
 */
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import type { RateState } from '@/lib/stats';

export type HeatScale = 'sequential' | 'diverging';

/** A bin: the full class strings of its fill and of its text, and its key under `chart.heatmap.bins`. */
export interface HeatBin {
  fill: string;
  text: string;
  key: string;
}

/**
 * The bounds between the bins above zero: 0 | under 10 | 10 to 20 | 20 to 35 | 35 to 50 | 50 to 70 | 70 and
 * up, in percent of answers. A lower bound belongs to the upper bin, and a rate is compared as the whole
 * percent the cell prints, so "10%" is never in the bin below 10.
 */
export const RATE_BIN_EDGES: readonly number[] = [0.1, 0.2, 0.35, 0.5, 0.7];

/**
 * The bounds of a change in points, per side: under 5, 5 to 15, 15 and up (owner default of Q3: no spec
 * names any). A change is compared as printed, to one decimal.
 */
const CHANGE_EDGES_POINTS: readonly number[] = [5, 15];

/**
 * Text colour by bin, from the measured pairs: in light `seq-5` needs `foreground` (4.85:1) and `seq-6` and
 * `seq-7` need `foreground-inverse`; in dark `seq-5` is the one bin that flips, to `foreground-inverse`
 * (4.55:1 since `--seq-5` was lifted to oklch(0.61 0.15 262)).
 */
export const SEQUENTIAL_BINS: readonly HeatBin[] = [
  { key: 'seq1', fill: 'bg-seq-1', text: 'text-foreground' },
  { key: 'seq2', fill: 'bg-seq-2', text: 'text-foreground' },
  { key: 'seq3', fill: 'bg-seq-3', text: 'text-foreground' },
  { key: 'seq4', fill: 'bg-seq-4', text: 'text-foreground' },
  { key: 'seq5', fill: 'bg-seq-5', text: 'text-foreground dark:text-foreground-inverse' },
  { key: 'seq6', fill: 'bg-seq-6', text: 'text-foreground-inverse' },
  { key: 'seq7', fill: 'bg-seq-7', text: 'text-foreground-inverse' },
];

/** From the largest fall to the largest rise: the key under a change heat-map, in order. */
export const DIVERGING_BINS: readonly HeatBin[] = [
  { key: 'divNeg3', fill: 'bg-div-neg-3', text: 'text-foreground-inverse' },
  { key: 'divNeg2', fill: 'bg-div-neg-2', text: 'text-foreground' },
  { key: 'divNeg1', fill: 'bg-div-neg-1', text: 'text-foreground' },
  { key: 'divZero', fill: 'bg-div-zero', text: 'text-foreground' },
  { key: 'divPos1', fill: 'bg-div-pos-1', text: 'text-foreground' },
  { key: 'divPos2', fill: 'bg-div-pos-2', text: 'text-foreground' },
  { key: 'divPos3', fill: 'bg-div-pos-3', text: 'text-foreground-inverse' },
];

/** The bin of a rate from 0 to 1, by the whole percent that is printed. Throws on anything else. */
export function sequentialBin(rate: number): HeatBin {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError(`A rate is a number from 0 to 1, got ${rate}`);
  }
  const printed = Math.round(rate * 100);
  if (printed === 0) return SEQUENTIAL_BINS[0] as HeatBin;
  const above = RATE_BIN_EDGES.filter((edge) => printed >= Math.round(edge * 100)).length;
  return SEQUENTIAL_BINS[1 + above] as HeatBin;
}

/**
 * The bin of a change in points. Colour is only for a change that is detectable (R5: the 95% interval of the
 * change excludes 0); anything else, and a change of exactly 0, is the neutral bin.
 */
export function divergingBin(points: number, detectable: boolean | null): HeatBin {
  if (!Number.isFinite(points)) throw new RangeError(`A change is a finite number of points, got ${points}`);
  const neutral = DIVERGING_BINS[3] as HeatBin;
  if (detectable !== true || points === 0) return neutral;
  const size = Math.round(Math.abs(points) * 10) / 10;
  const step = 1 + CHANGE_EDGES_POINTS.filter((edge) => size >= edge).length;
  return DIVERGING_BINS[points > 0 ? 3 + step : 3 - step] as HeatBin;
}

/** What the CSV needs of a cell: whether it has a rate, and its words with their counts (R1). */
export interface HeatCsvCell {
  state: RateState;
  /** The cell's accessible name, "CRM on ChatGPT: 47%, 64 of 136 answers". */
  tip: string;
}

/** A row as the CSV takes it: the label as plain text (the grid's label may be a node). */
export interface HeatCsvRow {
  label: string;
  prompts?: string | undefined;
  /** One per column, same order. */
  cells: readonly HeatCsvCell[];
  /** Subtopics or prompts, written after their parent. */
  children?: readonly HeatCsvRow[] | undefined;
}

export interface HeatCsvInput {
  rowHeader: string;
  /** The header of the Prompts column; without it the column is left out. */
  promptsHeader?: string | undefined;
  /** The word for a cell without answers ("n/a"): unknown is never written as 0 (R6). */
  noneText: string;
  columns: readonly string[];
  rows: readonly HeatCsvRow[];
}

/**
 * The heat-map as a table of words: a rate with its counts, an insufficient cell with its words, and a cell
 * without answers as `noneText`. Child rows follow their parent, named "Parent / Child".
 */
export function heatmapCsv({ rowHeader, promptsHeader, noneText, columns, rows }: HeatCsvInput): CsvTable {
  const withPrompts = promptsHeader !== undefined;
  const flatten = (row: HeatCsvRow, parent: string | null): CsvCell[][] => {
    if (row.cells.length !== columns.length) {
      throw new RangeError(`Row "${row.label}" has ${row.cells.length} cells for ${columns.length} columns`);
    }
    const label = parent === null ? row.label : `${parent} / ${row.label}`;
    const own: CsvCell[] = [
      safeText(label),
      ...(withPrompts ? [row.prompts === undefined ? null : safeText(row.prompts)] : []),
      ...row.cells.map((cell) => safeText(cell.state === 'none' ? noneText : cell.tip)),
    ];
    return [own, ...(row.children ?? []).flatMap((child) => flatten(child, label))];
  };
  return {
    header: [rowHeader, ...(withPrompts ? [promptsHeader] : []), ...columns].map(safeText),
    rows: rows.flatMap((row) => flatten(row, null)),
  };
}
