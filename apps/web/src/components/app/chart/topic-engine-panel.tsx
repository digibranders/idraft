'use client';

import type { Route } from 'next';
import type { ReactElement } from 'react';

import { BarList, BarListTable, type BarListProps, type BarValue, type ComparisonRow } from './bar-list';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import type { Density } from '@/lib/tables/table-state';

/**
 * One engine of a topic (SC-26): its rate with the counts behind it, or why there is no rate. The feature puts the
 * words to it (`valueText`, `contextText`, `accessibleText` come from its messages), so the panel holds no string of its
 * own and a prompt inspector or an Overview card can draw the same rows.
 */
export interface EnginePanelRow {
  /** The API engine code, which chooses the mark. */
  code: string;
  /** The engine's name. */
  label: string;
  /** `ok` from 4 valid answers: a bar and a percent. `insufficient`: its answers, no bar (R2). `none`: why there is nothing (R6). */
  state: 'ok' | 'insufficient' | 'none';
  /** The rate on the 0 to 1 scale; only when `state` is `ok`. The bar is as long as the rate is high. */
  value: number | null;
  /** The percent: "38%". */
  valueText: string;
  /** The counts beside it: "3 of 8 answers, 4 prompts"; `null` when there are none to say. */
  contextText: string | null;
  /** The valid answers behind an `insufficient` row. */
  answers: number;
  /** What a row without a rate says: "No answers", "None valid". */
  noneText: string;
  /** "ChatGPT: 38%, 3 of 8 answers". Starts with `label`; the row's only accessible content. */
  accessibleText: string;
  /** The hover and focus tooltip's second line. */
  tip?: string | undefined;
  /** Opens the topic's prompts on this engine. */
  href?: Route | undefined;
  /** The link replaces the history entry (the panel sits in a drawer that is already open). */
  replace?: boolean | undefined;
  /** Runs on a plain click in place of following `href`, which stays for a new tab. */
  onSelect?: (() => void) | undefined;
  /** The change since the compared window, coloured only when it is detectable. */
  delta?: ComparisonRow['delta'];
}

export interface TopicEnginePanelProps {
  /** Names the list and the table: "Mention by engine". */
  caption: string;
  labelHeader: string;
  valueHeader: string;
  contextHeader: string;
  /** The header of the table's change column; the column exists when a row has a change. */
  changeHeader?: string | undefined;
  /** One row for each engine, in the order the engines are shown. */
  rows: readonly EnginePanelRow[];
  density?: Density | undefined;
}

function barValue(row: EnginePanelRow): BarValue {
  if (row.state === 'ok' && row.value !== null) {
    return { kind: 'value', value: row.value, valueText: row.valueText, contextText: row.contextText };
  }
  return row.state === 'insufficient' ? { kind: 'thin', answers: row.answers } : { kind: 'none', text: row.noneText };
}

function barProps({ rows, density, ...words }: TopicEnginePanelProps): BarListProps {
  return {
    ...words,
    mode: 'comparison',
    rows: rows.map((row): ComparisonRow => ({
      id: row.code,
      label: row.label,
      // No engine is the own brand: every bar is the neutral colour, and the engines are never ranked by colour
      own: false,
      value: barValue(row),
      accessibleText: row.accessibleText,
      tip: row.tip,
      // The name is the row's label right beside it, so the mark stands alone
      icon: <EngineLogo engine={row.code} name="" />,
      href: row.href,
      replace: row.replace,
      onSelect: row.onSelect,
      delta: row.delta,
    })),
    // A rate fills its bar as far as the rate goes: 25% is a quarter of the track, on every row
    max: 1,
    density,
  };
}

/**
 * The engines of a topic as rows (SC-26, WB-TI-11): the engine's mark and name, a bar and the percent, the answers and
 * prompts behind it, and the change when the cells carry one. A row with fewer than 4 answers says its answers and draws
 * no bar; a row with none says why and is never 0. A row with an `href` is a link to the topic's prompts on that engine.
 * Engines are never pooled: each row is one engine.
 */
export function TopicEnginePanel(props: TopicEnginePanelProps): ReactElement {
  return <BarList {...barProps(props)} />;
}

/** The same rows as a table, for a frame's Table view: the engine, the value, the counts and the change. */
export function TopicEnginePanelTable(props: TopicEnginePanelProps): ReactElement {
  return <BarListTable {...barProps(props)} />;
}
