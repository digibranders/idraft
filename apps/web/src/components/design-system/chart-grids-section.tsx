'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { ChartFrame, type HtmlFrameProps } from '@/components/app/chart/chart-frame';
import { heatmapCsv, type HeatCsvRow } from '@/components/app/chart/heat-bins';
import { HeatmapGrid, type HeatCell, type HeatColumn, type HeatRow } from '@/components/app/chart/heatmap-grid';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import { LinkButton } from '@/components/ui/link-button';
import { SegmentedControl, type SegmentedControlItem } from '@/components/ui/segmented-control';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import { formatInteger, formatPercent, formatPointsDelta, formatSampleCount } from '@/lib/format';
import {
  differenceInterval,
  equalWeightAverage,
  isDetectableChange,
  rateState,
  wilsonInterval,
  type Counts,
} from '@/lib/stats';
import { DEFAULT_DENSITY, type Density } from '@/lib/tables/table-state';

/*
 * Every value on this page is fixed (no clock, no random numbers), so the preview and its visual test look the
 * same each time. Counts sit beside every percent and an unknown value is never a zero (rules R1 and R6).
 */

const DENSITY_ITEMS: readonly SegmentedControlItem<Density>[] = [
  { value: 'default', label: 'Default' },
  { value: 'compact', label: 'Compact' },
];

const formatRate = (value: number): string => formatPercent(value, { decimals: 0 });
/** Where a cell or a row goes in the specimens; in the app it is the prompt list filtered to the row and column. */
const OPENS = '/design-system/charts' as Route;

interface RateCellExtra {
  prompts?: number | undefined;
  pooledWeeks?: number | undefined;
  href?: Route | undefined;
}

/** One rate cell: the words of the tooltip come from `rateTipText`, so every percent has its counts beside it. */
function rateCell(counts: Counts, subject: string, words: RateTipWords, extra: RateCellExtra = {}): HeatCell {
  const { k, n } = counts;
  const state = rateState(n);
  const value = n === 0 ? null : k / n;
  const body = rateTipText(
    {
      value,
      k,
      n,
      band: state === 'ok' ? wilsonInterval(k, n) : null,
      thin: state === 'insufficient',
      prompts: extra.prompts,
      pooledWeeks: extra.pooledWeeks,
    },
    words,
  );
  return {
    value,
    answers: n,
    state,
    text: value === null ? '' : formatRate(value),
    tip: `${subject}: ${body}`,
    // Nothing to open for a cell without answers
    href: state === 'none' ? undefined : extra.href,
  };
}

/** The rows as the CSV takes them: plain names, and each cell's tip with its counts. */
const csvRows = (rows: readonly HeatRow[]): HeatCsvRow[] =>
  rows.map((row) => ({
    label: row.name,
    prompts: row.prompts,
    cells: row.cells.map(({ state, tip }) => ({ state, tip })),
    children: row.children === undefined ? undefined : csvRows(row.children),
  }));

/* ---------- 1. CH-04, topics by engine ---------- */

interface Topic {
  id: string;
  name: string;
  prompts: number;
  /** One per engine, in the engines' order. */
  counts: readonly Counts[];
  children?: readonly Topic[] | undefined;
}

const ENGINE_NAMES: readonly string[] = ['ChatGPT', 'Gemini', 'AI Mode'];
const ENGINE_IDS: readonly string[] = ['chatgpt', 'gemini', 'ai-mode'];
const TOPIC_COLUMNS: readonly HeatColumn[] = [
  ...ENGINE_NAMES.map((name, index) => ({ id: ENGINE_IDS[index] ?? name, label: name })),
  { id: 'average', label: 'Avg of 3' },
];

/** CRM has subtopics. Analytics has a thin cell (3 answers) and a cell with none, and Email a rate of 0%. */
const TOPICS: readonly Topic[] = [
  {
    id: 'crm',
    name: 'CRM',
    prompts: 17,
    counts: [
      { k: 64, n: 136 },
      { k: 38, n: 96 },
      { k: 20, n: 80 },
    ],
    children: [
      {
        id: 'crm-startups',
        name: 'CRM for startups',
        prompts: 6,
        counts: [
          { k: 11, n: 24 },
          { k: 7, n: 20 },
          { k: 1, n: 3 },
        ],
      },
      {
        id: 'crm-enterprise',
        name: 'CRM for enterprise',
        prompts: 11,
        counts: [
          { k: 5, n: 48 },
          { k: 0, n: 0 },
          { k: 9, n: 30 },
        ],
      },
    ],
  },
  {
    id: 'email',
    name: 'Email marketing',
    prompts: 12,
    counts: [
      { k: 27, n: 96 },
      { k: 74, n: 96 },
      { k: 0, n: 40 },
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    prompts: 9,
    counts: [
      { k: 2, n: 3 },
      { k: 0, n: 0 },
      { k: 8, n: 36 },
    ],
  },
  {
    id: 'billing',
    name: 'Billing',
    prompts: 6,
    counts: [
      { k: 9, n: 60 },
      { k: 16, n: 60 },
      { k: 21, n: 40 },
    ],
  },
];

/** The "avg of 3" column: each engine with a rate counts once (R3), and the words say how many took part. */
function averageCell(counts: readonly Counts[], subject: string): HeatCell {
  const shown = counts.filter(({ n }) => rateState(n) === 'ok');
  const { value, used } = equalWeightAverage(shown.map(({ k, n }) => k / n));
  if (value === null) {
    return {
      value: null,
      answers: 0,
      state: 'none',
      text: '',
      tip: `${subject}, average of engines: no engine has a rate`,
    };
  }
  const answers = shown.reduce((sum, { n }) => sum + n, 0);
  const named = shown.reduce((sum, { k }) => sum + k, 0);
  return {
    value,
    answers,
    state: 'ok',
    text: formatRate(value),
    tip: `${subject}, average of ${String(used)} engines: ${formatRate(value)}, equal weight, ${formatSampleCount(named, answers)} answers in all`,
  };
}

function topicRows(topics: readonly Topic[], words: RateTipWords): HeatRow[] {
  return topics.map((topic) => ({
    id: topic.id,
    label: topic.name,
    name: topic.name,
    prompts: formatInteger(topic.prompts),
    href: OPENS,
    cells: [
      ...topic.counts.map((counts, index) =>
        rateCell(counts, `${topic.name} on ${ENGINE_NAMES[index] ?? ''}`, words, {
          prompts: topic.prompts,
          href: OPENS,
        }),
      ),
      averageCell(topic.counts, topic.name),
    ],
    children: topic.children === undefined ? undefined : topicRows(topic.children, words),
  }));
}

const TOPIC_FOOTNOTE =
  'Fills: 0, under 10, 10 to 20, 20 to 35, 35 to 50, 50 to 70 and 70 and up percent of answers. Prompt weighted; a prompt in two topics counts in both. Avg of 3 gives each engine with a rate the same weight.';
const TOPIC_SUMMARY =
  'Mention rate by topic and engine. CRM is named in 64 of 136 ChatGPT answers, 38 of 96 Gemini answers and 20 of 80 AI Mode answers. Analytics has 3 ChatGPT answers, too few for a rate, and no Gemini answers.';

function TopicSpecimen({ density, words }: { density: Density; words: RateTipWords }): ReactElement {
  const rows = useMemo(() => topicRows(TOPICS, words), [words]);
  const csv = useMemo(
    () =>
      heatmapCsv({
        rowHeader: 'Topic',
        promptsHeader: 'Prompts',
        noneText: 'n/a',
        columns: TOPIC_COLUMNS.map((column) => String(column.label)),
        rows: csvRows(rows),
      }),
    [rows],
  );
  const grid = (form: 'grid' | 'table'): ReactElement => (
    <HeatmapGrid
      caption="Mention rate by topic and engine"
      rowHeader="Topic"
      promptsHeader="Prompts"
      columns={TOPIC_COLUMNS}
      rows={rows}
      scale="sequential"
      density={density}
      form={form}
    />
  );
  return (
    <div id="mention-rate-by-topic" className="min-w-0">
      <ChartFrame
        kind="html"
        title="Mention rate by topic and engine"
        variant="panel"
        meta="Last 28 days, 4 topics, 3 engines"
        footnote={TOPIC_FOOTNOTE}
        height={240}
        summary={TOPIC_SUMMARY}
        body={grid('grid')}
        table={grid('table')}
        menu={{
          fileName: 'mention-rate-by-topic-and-engine',
          link: 'https://app.idraft.test/design-system/chart-grids#mention-rate-by-topic',
          csv,
        }}
        status="ready"
      />
    </div>
  );
}

/* ---------- 2. CH-12, prompts by week ---------- */

const WEEK_LABELS: readonly string[] = [
  'Aug 31',
  'Sep 7',
  'Sep 14',
  'Sep 21',
  'Sep 28',
  'Oct 5',
  'Oct 12',
  'Oct 19',
  'Oct 26',
  'Nov 2',
];
const WEEK_COLUMNS: readonly HeatColumn[] = WEEK_LABELS.map((label) => ({ id: label, label }));
/** The first week of Extractor v4. */
const BOUNDARY_COLUMN = 6;

interface PromptWeeks {
  id: string;
  name: string;
  /** The answers of the 4 weeks to the week, one per week. */
  weeks: readonly Counts[];
}

const week = (k: number, n: number): Counts => ({ k, n });
const PROMPT_WEEKS: readonly PromptWeeks[] = [
  {
    id: 'best-crm',
    name: 'best crm for startups',
    weeks: [
      week(2, 8),
      week(3, 8),
      week(3, 8),
      week(4, 8),
      week(4, 8),
      week(5, 8),
      week(6, 8),
      week(6, 8),
      week(7, 8),
      week(7, 8),
    ],
  },
  {
    id: 'crm-email',
    name: 'crm with email automation',
    weeks: [
      week(0, 8),
      week(1, 8),
      week(0, 8),
      week(0, 8),
      week(1, 8),
      week(2, 8),
      week(1, 8),
      week(2, 8),
      week(2, 8),
      week(3, 8),
    ],
  },
  {
    id: 'crm-pricing',
    name: 'crm pricing comparison',
    weeks: [
      week(4, 8),
      week(4, 8),
      week(5, 8),
      week(2, 3),
      week(4, 8),
      week(0, 0),
      week(3, 8),
      week(5, 9),
      week(5, 8),
      week(6, 8),
    ],
  },
];

function weekRows(words: RateTipWords): HeatRow[] {
  return PROMPT_WEEKS.map((prompt) => ({
    id: prompt.id,
    label: prompt.name,
    name: prompt.name,
    cells: prompt.weeks.map((counts, index) =>
      rateCell(counts, `${prompt.name}, 4 weeks to ${WEEK_LABELS[index] ?? ''}`, words, { pooledWeeks: 4 }),
    ),
  }));
}

function WeekSpecimen({ density, words }: { density: Density; words: RateTipWords }): ReactElement {
  const rows = useMemo(() => weekRows(words), [words]);
  const grid = (form: 'grid' | 'table'): ReactElement => (
    <HeatmapGrid
      caption="Mention rate by prompt and week"
      rowHeader="Prompt"
      columns={WEEK_COLUMNS}
      rows={rows}
      scale="sequential"
      boundaries={[BOUNDARY_COLUMN]}
      density={density}
      form={form}
    />
  );
  return (
    <div className="min-w-0">
      <ChartFrame
        kind="html"
        title="Mention rate by prompt and week"
        variant="panel"
        meta="Last 10 weeks, 3 prompts, 1 version boundary"
        footnote="Each cell pools the 4 weeks to the week shown. The rule marks the first week of Extractor v4, Oct 12."
        height={180}
        summary="Mention rate of three prompts over 10 weeks, each cell pooling 4 weeks. The prompt best crm for startups rises from 2 of 8 answers to 7 of 8. Extractor v4 starts in the week of Oct 12."
        body={grid('grid')}
        table={grid('table')}
        menu={{
          fileName: 'mention-rate-by-prompt-and-week',
          csv: heatmapCsv({
            rowHeader: 'Prompt',
            noneText: 'n/a',
            columns: WEEK_LABELS,
            rows: csvRows(rows),
          }),
        }}
        status="ready"
      />
    </div>
  );
}

/* ---------- 3. Change in points, diverging ---------- */

interface Change {
  previous: Counts;
  current: Counts;
}

interface TopicChange {
  id: string;
  name: string;
  /** One per engine. */
  changes: readonly Change[];
}

const change = (previous: Counts, current: Counts): Change => ({ previous, current });
const TOPIC_CHANGES: readonly TopicChange[] = [
  {
    id: 'crm',
    name: 'CRM',
    changes: [
      change({ k: 50, n: 136 }, { k: 78, n: 136 }),
      change({ k: 30, n: 96 }, { k: 33, n: 96 }),
      change({ k: 20, n: 80 }, { k: 22, n: 80 }),
    ],
  },
  {
    id: 'email',
    name: 'Email marketing',
    changes: [
      change({ k: 20, n: 96 }, { k: 45, n: 96 }),
      change({ k: 60, n: 100 }, { k: 35, n: 100 }),
      change({ k: 2, n: 3 }, { k: 5, n: 20 }),
    ],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    changes: [
      change({ k: 40, n: 80 }, { k: 33, n: 80 }),
      change({ k: 0, n: 0 }, { k: 0, n: 0 }),
      change({ k: 18, n: 60 }, { k: 12, n: 60 }),
    ],
  },
];

/** A change in points. Only a change whose 95% interval excludes 0 is coloured (R5); the tip says which it is. */
function changeCell({ previous, current }: Change, subject: string): HeatCell {
  const known = rateState(previous.n) === 'ok' && rateState(current.n) === 'ok';
  if (!known) {
    const none = previous.n === 0 || current.n === 0;
    return {
      value: null,
      answers: Math.min(previous.n, current.n),
      state: none ? 'none' : 'insufficient',
      text: '',
      tip: none
        ? `${subject}: no answers in one of the two periods`
        : `${subject}: too few answers to compare, ${String(previous.n)} then ${String(current.n)}`,
    };
  }
  const before = previous.k / previous.n;
  const after = current.k / current.n;
  const delta = after - before;
  const band = differenceInterval(current, previous);
  const detectable = isDetectableChange(current, previous);
  const parts = [
    `${formatRate(before)} then ${formatRate(after)}`,
    formatPointsDelta(delta),
    band === null ? null : `95% interval ${formatPointsDelta(band.low)} to ${formatPointsDelta(band.high)}`,
    detectable === true ? 'detectable' : 'within normal variation',
    `${formatSampleCount(previous.k, previous.n)} then ${formatSampleCount(current.k, current.n)} answers`,
  ];
  return {
    value: delta * 100,
    answers: Math.min(previous.n, current.n),
    state: 'ok',
    text: formatPointsDelta(delta),
    tip: `${subject}: ${parts.filter((part) => part !== null).join(', ')}`,
    detectable,
  };
}

const changeRows = (): HeatRow[] =>
  TOPIC_CHANGES.map((topic) => ({
    id: topic.id,
    label: topic.name,
    name: topic.name,
    cells: topic.changes.map((entry, index) => changeCell(entry, `${topic.name} on ${ENGINE_NAMES[index] ?? ''}`)),
  }));

function ChangeSpecimen({ density }: { density: Density }): ReactElement {
  const rows = useMemo(() => changeRows(), []);
  const grid = (form: 'grid' | 'table'): ReactElement => (
    <HeatmapGrid
      caption="Change in mention rate by topic and engine"
      rowHeader="Topic"
      columns={TOPIC_COLUMNS.slice(0, ENGINE_NAMES.length)}
      rows={rows}
      scale="diverging"
      density={density}
      form={form}
    />
  );
  return (
    <div className="min-w-0">
      <ChartFrame
        kind="html"
        title="Change in mention rate by topic and engine"
        variant="panel"
        meta="Last 28 days against the 28 days before"
        footnote="A cell is filled only when the 95% interval of the change excludes 0. Other changes are within normal variation and stay neutral."
        height={180}
        summary="Change in points of the mention rate. CRM on ChatGPT rose by 20.6 points, a detectable change. CRM on Gemini rose by 3.1 points, within normal variation."
        body={grid('grid')}
        table={grid('table')}
        status="ready"
      />
    </div>
  );
}

/* ---------- 4. Frame states ---------- */

const STATE_VIEW: Omit<HtmlFrameProps, 'title'> = {
  kind: 'html',
  variant: 'panel',
  meta: 'Last 28 days, 4 topics, 3 engines',
  height: 180,
  summary: 'Mention rate by topic and engine.',
  body: null,
  table: null,
};

function ErrorSpecimen(): ReactElement {
  const [retrying, setRetrying] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const retry = (): void => {
    setRetrying(true);
    timer.current = window.setTimeout(() => setRetrying(false), 1000);
  };
  return (
    <ChartFrame
      {...STATE_VIEW}
      title="Mention rate by topic, error"
      status="error"
      error={{
        title: 'Could not load the topics',
        reason: 'The server returned an error. Your filters are unchanged.',
        errorId: null,
        onRetry: retry,
        retrying,
        retryLabel: 'Retry',
      }}
    />
  );
}

function StatesSpecimen({ density, words }: { density: Density; words: RateTipWords }): ReactElement {
  const rows = useMemo(() => topicRows(TOPICS.slice(1, 3), words), [words]);
  const grid = (
    <HeatmapGrid
      caption="Mention rate by topic and engine, stale"
      rowHeader="Topic"
      promptsHeader="Prompts"
      columns={TOPIC_COLUMNS}
      rows={rows}
      scale="sequential"
      density={density}
    />
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0">
        <ChartFrame {...STATE_VIEW} title="Mention rate by topic, loading" status="loading" />
      </div>
      <div className="min-w-0">
        <ChartFrame
          {...STATE_VIEW}
          title="Mention rate by topic, empty"
          status="empty"
          empty={{
            title: 'No topics yet',
            reason: 'Group prompts into topics to see where you are strong.',
            action: (
              <LinkButton size="sm" render={<Link href="/design-system/charts" />}>
                Assign topics
              </LinkButton>
            ),
          }}
        />
      </div>
      <div className="min-w-0">
        <ErrorSpecimen />
      </div>
      <div className="min-w-0">
        <ChartFrame
          {...STATE_VIEW}
          title="Mention rate by topic, stale"
          body={grid}
          table={grid}
          notice={{ kind: 'stale', text: 'Stale: last collected Nov 9, 18:30 CET' }}
          status="ready"
        />
      </div>
    </div>
  );
}

/* ---------- The section ---------- */

function HeatmapSpecimens(): ReactElement {
  const words = useRateTipWords();
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl<Density>
          semantics="view"
          size="sm"
          label="Density"
          value={density}
          onValueChange={setDensity}
          items={DENSITY_ITEMS}
        />
        <p className="type-meta">Density sets the height of the rows. On a narrow screen the table scrolls sideways.</p>
      </div>
      <TopicSpecimen density={density} words={words} />
      <WeekSpecimen density={density} words={words} />
      <ChangeSpecimen density={density} />
      <StatesSpecimen density={density} words={words} />
    </div>
  );
}

export function ChartGridsSection(): ReactNode {
  return (
    <>
      <SpecimenGroup title="Heat-map table">
        <p className="type-body">
          Shows a rate by row and column on one shared set of bins. Cells with too few answers are hatched instead of
          coloured, and topic rows open into their prompts as tree rows.
        </p>
        <HeatmapSpecimens />
      </SpecimenGroup>

      <SpecimenGroup title="Small multiples">
        <p className="type-body">
          Shows the same measure in a grid of small charts. Every chart shares one ceiling, and a crosshair moved over
          one chart appears on all of them.
        </p>
      </SpecimenGroup>
    </>
  );
}
