import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ComponentType, type ReactElement } from 'react';

import {
  competitor,
  engine,
  entityCells,
  id,
  own,
  pool,
  projectEntity,
  share,
  summaryOf,
  week,
  weighted,
} from '@/features/ai-overview/cards/competitors/model/summary-fixtures';
import type { ExportBlock } from '@/features/ai-overview/export/export-model';
import { ExportProvider, useExportBlocks } from '@/features/ai-overview/export/export-registry';
import type { CardProps } from '@/features/layouts';
import type { ProjectEntity, PromptsSummary, WeekCells } from '@/lib/api/types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import type { Width } from '@/lib/layouts';
import { cardInOverview, type OverviewWorld } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/*
 * What the tests of the three weekly cards (CH-06, CH-19, CH-29) share: ECharts stood in for by a recorder of the
 * option the frame builds, the weekly summary of one engine written as counts, and a render of one card inside
 * the real provider, grid and export registry. Not a test file: it is imported by the card tests.
 */

export const TOKENS: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Geist',
  other: '#other',
  reference: '#reference',
  grid: '#grid',
  band: '#band',
  rankBandNone: '#none',
  surfaceElevated: '#elevated',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
};

type OptionBuilder = (tokens: ChartTokens) => Record<string, unknown>;
let latestBuilder: OptionBuilder | null = null;

/** The stand-in for `@/components/app/chart/echart`: jsdom has no canvas, so the option is what a test reads. */
export const echartStandIn = {
  EChart: ({ option }: { option: OptionBuilder }): ReactElement => {
    latestBuilder = option;
    return <div data-testid="echart-canvas" />;
  },
};

/** The option the frame last gave the canvas, built with the test tokens. */
export function drawnOption(): Record<string, unknown> {
  if (latestBuilder === null) throw new Error('No chart was drawn');
  return latestBuilder(TOKENS);
}

export interface DrawnSeries {
  id: string;
  name?: string;
  type: string;
  stack?: string;
  color?: string;
  data: unknown[];
  markLine?: { data: { xAxis: string }[] };
  [key: string]: unknown;
}

export const drawnSeries = (): DrawnSeries[] => drawnOption().series as DrawnSeries[];

/** The text of a tooltip's markup, one `|` between its parts. */
export function tooltipText(index: number): string {
  const tooltip = drawnOption().tooltip as { formatter: (params: unknown) => string };
  return tooltip
    .formatter([{ dataIndex: index, axisValueLabel: 'axis' }])
    .replace(/<[^>]+>/g, '|')
    .replace(/\|+/g, '|')
    .replace(/^\||\|$/g, '');
}

export const yAxisOf = (): Record<string, unknown> => drawnOption().yAxis as Record<string, unknown>;

/** The labels of the x axis the frame drew, one per week. */
export const drawnCategories = (): string[] => (drawnOption().xAxis as { data: string[] }).data;

export const ENGINE = 'chatgpt_web';
export const NAMES = ['Fynix', 'HubSpot', 'Zoho'] as const;

/** One week of one engine: the answers naming a tracked brand and the numerators of the shares of voice, one per brand. */
export interface WeekSpec {
  start: string;
  answers: number;
  numerators: readonly number[];
  /** Valid answers of the week, and how many of them name each brand. */
  mentions: { n: number; ks: readonly number[] };
  /** The API pooled this week with the weeks before it: how many, and the days they cover. */
  pooled?: { weeks: number; from: string; to: string };
}

/** A leading week with no answers, then a good week, a thin one, and two good ones (the mock's own shape). */
export const WEEKS: readonly WeekSpec[] = [
  {
    start: '2026-10-12',
    answers: 0,
    numerators: [0, 0, 0],
    mentions: { n: 0, ks: [0, 0, 0] },
    pooled: { weeks: 1, from: '2026-10-12', to: '2026-10-18' },
  },
  { start: '2026-10-19', answers: 100, numerators: [40, 35, 25], mentions: { n: 200, ks: [80, 70, 50] } },
  { start: '2026-10-26', answers: 3, numerators: [1, 1.5, 0.5], mentions: { n: 3, ks: [1, 2, 0] } },
  { start: '2026-11-02', answers: 120, numerators: [36, 54, 30], mentions: { n: 240, ks: [84, 120, 60] } },
  { start: '2026-11-09', answers: 100, numerators: [30, 50, 20], mentions: { n: 200, ks: [60, 100, 40] } },
];

/** A week with no answer at all, as the mock has before the window start: the weekly cards leave it off the axis. */
export const idleWeek = (start: string): WeekSpec => ({
  start,
  answers: 0,
  numerators: [0, 0, 0],
  mentions: { n: 0, ks: [0, 0, 0] },
  pooled: { weeks: 1, from: start, to: start },
});

/** The mock's weeks with the thin week of Oct 26 left empty: a gap between two weeks that have answers. */
export const WEEKS_WITH_GAP: readonly WeekSpec[] = WEEKS.map((spec) =>
  spec.start === '2026-10-26' ? idleWeek(spec.start) : spec,
);

/** The mock's weeks with the week of Nov 2 pooled by the API over the four weeks from Oct 19 to Nov 9. */
export const POOLED_WEEKS: readonly WeekSpec[] = WEEKS.map((spec) =>
  spec.start === '2026-11-02' ? { ...spec, pooled: { weeks: 4, from: '2026-10-19', to: '2026-11-09' } } : spec,
);

/** Six tracked brands, for the cards that cut the competitors they draw. */
export const SIX_NAMES = ['Fynix', 'HubSpot', 'Zoho', 'Pipedrive', 'Salesforce', 'Freshworks'] as const;

/** A leading week with no answers, then three good weeks; HubSpot leads, then Pipedrive, then Zoho. */
export const SIX_WEEKS: readonly WeekSpec[] = [
  { ...(WEEKS[0] as WeekSpec), numerators: [0, 0, 0, 0, 0, 0], mentions: { n: 0, ks: [0, 0, 0, 0, 0, 0] } },
  {
    start: '2026-10-19',
    answers: 100,
    numerators: [20, 25, 15, 20, 10, 10],
    mentions: { n: 200, ks: [60, 100, 40, 80, 30, 20] },
  },
  {
    start: '2026-10-26',
    answers: 100,
    numerators: [20, 30, 15, 20, 10, 5],
    mentions: { n: 200, ks: [60, 100, 40, 80, 30, 20] },
  },
  {
    start: '2026-11-02',
    answers: 100,
    numerators: [25, 25, 10, 20, 10, 10],
    mentions: { n: 200, ks: [60, 100, 40, 80, 30, 20] },
  },
];

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const mentionCell = (k: number, n: number): ReturnType<typeof weighted> =>
  weighted(k, n, n === 0 ? [] : Array<number>(10).fill(k / n));

function weekCells(spec: WeekSpec, brands: number): WeekCells {
  const entities = Array.from({ length: brands }, (_, index) =>
    entityCells(
      id(index + 1),
      mentionCell(spec.mentions.ks[index] ?? 0, spec.mentions.n),
      share(spec.numerators[index] ?? 0, spec.answers),
    ),
  );
  return week(spec.start, {
    share: share(spec.answers, spec.answers),
    mentioned: mentionCell(spec.mentions.ks[0] ?? 0, spec.mentions.n),
    entities,
    ...(spec.pooled === undefined ? {} : { pool: pool(spec.pooled.weeks, spec.pooled.from, spec.pooled.to) }),
  });
}

export interface SummaryShape {
  weeks?: readonly WeekSpec[];
  /** The tracked brands: own first. */
  names?: readonly string[];
  versions?: number[];
}

/** The `weekly` summary of the engine: the window total is the sum of the weeks, as the server's would be. */
export function weeklySummary({ weeks = WEEKS, names = NAMES, versions = [1] }: SummaryShape = {}): PromptsSummary {
  const brands = names.length;
  const answers = sum(weeks.map((spec) => spec.answers));
  const valid = sum(weeks.map((spec) => spec.mentions.n));
  const total = engine(ENGINE, {
    mentioned: mentionCell(sum(weeks.map((spec) => spec.mentions.ks[0] ?? 0)), valid),
    share: share(answers, answers),
    entities: names.map((_, index) =>
      entityCells(
        id(index + 1),
        mentionCell(sum(weeks.map((spec) => spec.mentions.ks[index] ?? 0)), valid),
        share(sum(weeks.map((spec) => spec.numerators[index] ?? 0)), answers),
      ),
    ),
    series: weeks.map((spec) => weekCells(spec, brands)),
  });
  const summary = summaryOf({
    entities: names.map((name, index) => (index === 0 ? own(1, name) : competitor(index + 1, name))),
    total: [total],
    versions,
  });
  return summary.total === undefined || summary.total === null
    ? summary
    : { ...summary, total: { ...summary.total, prompt_count: 24 } };
}

/** The entities read of the project: the colour slot of each brand and the day it joined. */
export function entityRows(
  names: readonly string[] = NAMES,
  addedAt: Readonly<Record<string, string>> = {},
): ProjectEntity[] {
  return names.map((name, index) =>
    projectEntity(index + 1, name, {
      role: index === 0 ? 'own' : 'competitor',
      colorIndex: index + 1,
      addedAt: addedAt[name] ?? '2026-01-05T09:00:00Z',
    }),
  );
}

const PROJECT_PATH = '*/api/v1/workspaces/:w/projects/:p';

export function serveSummary(summary: PromptsSummary): void {
  server.use(http.get(`${PROJECT_PATH}/ai/prompts-summary`, () => HttpResponse.json({ data: summary })));
}

export function serveSummaryFailure(): void {
  server.use(
    http.get(`${PROJECT_PATH}/ai/prompts-summary`, () =>
      HttpResponse.json(
        { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req-weekly' },
        { status: 500, headers: { 'content-type': 'application/problem+json' } },
      ),
    ),
  );
}

export function serveEntities(rows: readonly ProjectEntity[]): void {
  server.use(http.get(`${PROJECT_PATH}/entities`, () => HttpResponse.json({ data: rows })));
}

/** Serves a summary and the entities read that goes with it. */
export function serveWorld(summary: PromptsSummary, rows: readonly ProjectEntity[] = entityRows()): void {
  serveSummary(summary);
  serveEntities(rows);
}

function ExportProbe(): ReactElement {
  const read = useExportBlocks();
  const [blocks, setBlocks] = useState<readonly ExportBlock[]>([]);
  return (
    <>
      <button type="button" onClick={() => setBlocks(read().blocks)}>
        Read export
      </button>
      <pre data-testid="export-blocks">{JSON.stringify(blocks)}</pre>
    </>
  );
}

export interface RenderCardOptions {
  world?: OverviewWorld;
  searchParams?: string;
  width?: Width;
}

/** One card, with its options fixed, in the page's provider, grid and export registry. */
export function renderCard(
  type: string,
  Card: ComponentType<CardProps>,
  options: Readonly<Record<string, string>>,
  { world = 'fynix', searchParams = 'cmp=off', width = 'two_thirds' }: RenderCardOptions = {},
): ProvidedRender {
  function WithOptions(props: CardProps): ReactElement {
    return <Card {...props} options={options} />;
  }
  return renderWithProviders(
    <ExportProvider>
      {cardInOverview({ type, Card: WithOptions, world, width })}
      <ExportProbe />
    </ExportProvider>,
    { searchParams },
  );
}

/** The blocks the export registry holds now, after the probe's button is pressed. */
export async function readExport(user: ProvidedRender['user']): Promise<ExportBlock[]> {
  await user.click(screen.getByRole('button', { name: 'Read export' }));
  return JSON.parse(screen.getByTestId('export-blocks').textContent) as ExportBlock[];
}
