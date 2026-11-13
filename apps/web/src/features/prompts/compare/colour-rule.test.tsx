import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, screen, within } from '@testing-library/react';
import { useMemo, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { cell, engineOf, projectEngine, promptsOf } from './change-test-data';
import { ComparedWindowProvider } from './compared-window';
import type { PromptCounts } from '../inspector-reads';
import { InspectorStrip } from '../inspector-strip';
import { usePromptColumns, type PromptRow } from '../prompt-columns';
import { PromptsStrip } from '../prompts-strip';
import { useRateColumns } from '../rate-columns';
import { TopicInspector } from '../topic-inspector';
import { promptRow, topicRow } from '../topics-by-engine/cells-fixtures';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { EngineSummary, MetricCell } from '@/lib/api/types';
import type { StripPrompt } from '@/lib/rates/strip-model';
import { renderWithProviders } from '@/test/render';
import { DRAWER_TOPIC_ID, READY_COUNTS, drawerExtras, summaryOf } from '@/test/topic-drawer-harness';

/**
 * WB-DATA-02, the proof: every surface that draws a change colours it by the change's own test and by nothing else.
 * Each surface is built with real components and constructed cells, so what is drawn does not depend on what the mock
 * happens to hold: a change that is detectable is coloured by its polarity, one within normal variation or without a
 * test is neutral, and the sign of the points alone never picks a colour. Then a scan of the source proves no file of
 * the package names a tone class of its own.
 */

// jsdom has no canvas: the drawer's charts are drawn as an empty box
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

// The drawer's engine panel builds its links from the address the page is on
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

const WINDOW = { from: '2026-09-18', to: '2026-10-15' };
const CHAT = projectEngine('chatgpt_web');

type Pair = readonly [MetricCell, MetricCell];

/** The three classes `Delta` has: the tone map is its alone. */
const TONES = {
  positive: 'text-positive-text',
  negative: 'text-negative-text',
  neutral: 'text-foreground-secondary',
} as const;
type Tone = keyof typeof TONES;

/** The prompt weighted rate rose 32.5 points while the answers pooled fell: the two disagree, so no test is claimed. */
const APART: Pair = [
  { value: 0.625, numerator: 2.5, denominator: 4, n_observations: 12, pooled: { successes: 3, trials: 12 } },
  { value: 0.3, numerator: 1.2, denominator: 4, n_observations: 20, pooled: { successes: 12, trials: 20 } },
];

type Kind =
  | 'detectable rise'
  | 'detectable fall'
  | 'rise within normal variation'
  | 'fall within normal variation'
  | 'no test'
  | 'unknown';

interface Case {
  kind: Kind;
  /** The engine's cells now and in the compared window. */
  pair: Pair;
  /** The same change as the prompts of a strip chip. */
  prompts: readonly StripPrompt[];
  /** `null`: nothing is drawn. */
  expected: { tone: Tone; sign: '+' | '-'; says: 'detectable' | 'within' | 'nothing' } | null;
}

const single = (pair: Pair): readonly StripPrompt[] => promptsOf([pair[0], pair[1]]);
// 30 of 60 against 12 of 60 is larger than normal variation; 31 of 60 against 27 of 60 is not
const UP: Pair = [cell(30, 60), cell(12, 60)];
const DOWN: Pair = [cell(12, 60), cell(30, 60)];
const WITHIN_UP: Pair = [cell(31, 60), cell(27, 60)];
const WITHIN_DOWN: Pair = [cell(27, 60), cell(31, 60)];
const FEW: Pair = [cell(30, 60), cell(1, 3)];

const CASES: readonly Case[] = [
  {
    kind: 'detectable rise',
    pair: UP,
    prompts: single(UP),
    expected: { tone: 'positive', sign: '+', says: 'detectable' },
  },
  {
    kind: 'detectable fall',
    pair: DOWN,
    prompts: single(DOWN),
    expected: { tone: 'negative', sign: '-', says: 'detectable' },
  },
  {
    kind: 'rise within normal variation',
    pair: WITHIN_UP,
    prompts: single(WITHIN_UP),
    expected: { tone: 'neutral', sign: '+', says: 'within' },
  },
  {
    kind: 'fall within normal variation',
    pair: WITHIN_DOWN,
    prompts: single(WITHIN_DOWN),
    expected: { tone: 'neutral', sign: '-', says: 'within' },
  },
  {
    kind: 'no test',
    pair: APART,
    // Two prompts whose own rates rose while their answers pooled fell
    prompts: promptsOf([cell(2, 2), cell(0, 1)], [cell(3, 12), cell(12, 20)]),
    expected: { tone: 'neutral', sign: '+', says: 'nothing' },
  },
  // A previous period of 3 answers has no rate: the change is not told, and it is not 0
  { kind: 'unknown', pair: FEW, prompts: single(FEW), expected: null },
];

interface Surface {
  name: string;
  /** Renders the surface with the change and returns the box the change is drawn in. */
  draw: (change: Case) => Promise<HTMLElement> | HTMLElement;
}

const chatCells = (change: Case): EngineSummary[] => [engineOf('chatgpt_web', change.pair[0], change.pair[1])];

/** The strip chip of ChatGPT: its value is the tab stop that holds the tooltip. */
function stripChip(change: Case): HTMLElement {
  renderWithProviders(
    <ComparedWindowProvider value={WINDOW}>
      <PromptsStrip prompts={change.prompts} engines={[CHAT]} topics={1} status="ready" countsFailed={false} />
    </ComparedWindowProvider>,
  );
  const chip = screen.getByText('ChatGPT', { selector: 'dt' }).parentElement;
  if (chip === null) throw new Error('The ChatGPT chip is missing');
  return within(chip).getByRole('definition');
}

interface CellsRow {
  cells: readonly EngineSummary[] | undefined;
}
const rowCells = (row: CellsRow): readonly EngineSummary[] | undefined => row.cells;

function MentionCell({ row }: { row: CellsRow }): ReactElement {
  const columns = useRateColumns<CellsRow>([CHAT], rowCells);
  return <div data-testid="mention-cell">{columns.mention.cell(row)}</div>;
}

function mentionCell(change: Case): HTMLElement {
  renderWithProviders(
    <ComparedWindowProvider value={WINDOW}>
      <MentionCell row={{ cells: chatCells(change) }} />
    </ComparedWindowProvider>,
  );
  return screen.getByTestId('mention-cell');
}

/** A row of the Prompts tab with the engine cells its summary has. */
const promptTableRow = (cells: readonly EngineSummary[]): PromptRow =>
  ({
    prompt: { prompt_id: 'prompt', current_version: { text: 'prompt' }, is_branded: false },
    summary: { prompt_id: 'prompt', engines: cells },
    countsLoaded: true,
    topics: null,
    topicList: [],
    country: null,
  }) as unknown as PromptRow;

function ChangeColumnCell({ row }: { row: PromptRow }): ReactElement {
  const { columns } = usePromptColumns([CHAT], 'mention', WINDOW);
  const column: DataTableColumn<PromptRow> | undefined = useMemo(
    () => columns.find((entry) => entry.id === 'change_chatgpt_web'),
    [columns],
  );
  return <div data-testid="change-cell">{column?.cell(row)}</div>;
}

function changeColumnCell(change: Case): HTMLElement {
  renderWithProviders(<ChangeColumnCell row={promptTableRow(chatCells(change))} />);
  return screen.getByTestId('change-cell');
}

function inspectorItem(change: Case): HTMLElement {
  const counts: PromptCounts = {
    status: 'ready',
    row: promptRow('p1', 'What is the best CRM?', [], chatCells(change)),
    entities: [],
    brandedIncluded: false,
    errorId: null,
    retry: () => undefined,
    retrying: false,
  };
  renderWithProviders(
    <ComparedWindowProvider value={WINDOW}>
      <InspectorStrip engines={[CHAT]} counts={counts} noCountsReason="No counts" />
    </ComparedWindowProvider>,
  );
  const item = screen.getByText('ChatGPT mention').closest('dt')?.parentElement?.querySelector('dd');
  if (item === null || item === undefined) throw new Error('The ChatGPT mention item is missing');
  return item;
}

/** The drawer of a topic with one prompt, both of them with the engine cells of the change. */
function renderDrawer(change: Case): void {
  const prompt = promptRow('p', 'Prompt p', [DRAWER_TOPIC_ID], chatCells(change));
  const summary = {
    ...summaryOf([topicRow(DRAWER_TOPIC_ID, 'Paid Search', 1, chatCells(change))]),
    prompts: [prompt],
  };
  renderWithProviders(
    <ComparedWindowProvider value={WINDOW}>
      <TopicInspector
        topicKey={DRAWER_TOPIC_ID}
        summary={summary}
        counts={READY_COUNTS}
        engines={[CHAT]}
        descendants={new Map([[DRAWER_TOPIC_ID, new Set([DRAWER_TOPIC_ID])]])}
        treeName="Paid Search"
        treePending={false}
        extras={drawerExtras()}
        tab="overview"
        onTabChange={() => undefined}
        onOpenPrompt={() => undefined}
        onClose={() => undefined}
      />
    </ComparedWindowProvider>,
  );
}

async function sectionOf(name: string): Promise<HTMLElement> {
  const section = (await screen.findByRole('heading', { name })).closest('section');
  if (section === null) throw new Error(`The ${name} section is missing`);
  return section;
}

async function drawerCard(change: Case): Promise<HTMLElement> {
  renderDrawer(change);
  const value = (await screen.findByText('Mentioned', { selector: 'dt' })).parentElement?.querySelector('dd');
  if (value === null || value === undefined) throw new Error('The Mentioned card is missing');
  return value;
}

async function topPrompt(change: Case): Promise<HTMLElement> {
  renderDrawer(change);
  const item = within(await sectionOf('Top prompts'))
    .getByText('Prompt p')
    .closest('li');
  if (item === null) throw new Error('The top prompt is missing');
  return item;
}

async function byEngineRow(change: Case): Promise<HTMLElement> {
  renderDrawer(change);
  return sectionOf('By engine');
}

const SURFACES: readonly Surface[] = [
  { name: 'the strip chip', draw: stripChip },
  { name: 'the Mention cell', draw: mentionCell },
  { name: 'the change column cell', draw: changeColumnCell },
  { name: 'the inspector strip item', draw: inspectorItem },
  { name: 'the drawer card', draw: drawerCard },
  { name: 'the top prompt change', draw: topPrompt },
  { name: 'the By engine row', draw: byEngineRow },
];

interface Drawn {
  tone: Tone;
  sign: string;
  spoken: string;
}

/** The one change drawn in `region`, as a person sees it and as a screen reader says it; `null` when none is drawn. */
function drawnIn(region: HTMLElement): Drawn | null {
  const visible = Array.from(region.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')).filter((element) =>
    /pts$/.test(element.textContent ?? ''),
  );
  if (visible.length === 0) return null;
  const [first] = visible;
  if (first === undefined || visible.length > 1) throw new Error(`${String(visible.length)} changes are drawn here`);
  const tones = (Object.keys(TONES) as Tone[]).filter((tone) => first.classList.contains(TONES[tone]));
  const [tone] = tones;
  if (tone === undefined || tones.length !== 1) throw new Error(`The change has ${String(tones.length)} tone classes`);
  const text = first.textContent ?? '';
  return { tone, sign: text.startsWith('+') ? '+' : '-', spoken: first.nextElementSibling?.textContent ?? '' };
}

const MATRIX = SURFACES.flatMap((surface) =>
  CASES.map((change) => [surface.name, change.kind, surface, change] as const),
);

describe('colour only when the change is detectable (WB-DATA-02)', () => {
  it.each(MATRIX)('%s, %s: coloured, worded and tested as the rule says', async (_surface, _kind, surface, change) => {
    const region = await surface.draw(change);
    const drawn = drawnIn(region);
    const { expected } = change;
    if (expected === null) {
      // Unknown is not 0: no change, no words about one
      expect(drawn).toBeNull();
      expect(region.textContent).not.toMatch(/\bpts\b|detectable|normal variation/);
      return;
    }
    if (drawn === null) throw new Error('No change is drawn');

    // A detectable change is coloured by its polarity; everything else is neutral
    expect(drawn.tone).toBe(expected.tone);
    expect(drawn.sign).toBe(expected.sign);
    expect(drawn.spoken.startsWith(expected.sign === '+' ? 'up ' : 'down ')).toBe(true);

    if (expected.says === 'detectable') {
      expect(drawn.spoken).toMatch(/, detectable, interim test$/);
      expect(drawn.spoken).not.toMatch(/within normal variation/);
    } else if (expected.says === 'within') {
      expect(drawn.spoken).toMatch(/, within normal variation, interim test$/);
      expect(drawn.spoken).not.toMatch(/detectable/);
    } else {
      // No test was made: nothing is said about variation, and no test is claimed
      expect(drawn.spoken).toMatch(/^(up|down) \d+(\.\d)? pts$/);
    }
  });

  it.each(SURFACES)(
    '%s: the same sign gets a different tone, so the tone never follows the sign alone',
    async (surface) => {
      const toneOf = async (kind: Kind): Promise<Drawn> => {
        cleanup();
        const change = CASES.find((entry) => entry.kind === kind);
        if (change === undefined) throw new Error(`No case ${kind}`);
        const drawn = drawnIn(await surface.draw(change));
        if (drawn === null) throw new Error(`No change is drawn for ${kind}`);
        return drawn;
      };
      const rise = await toneOf('detectable rise');
      const calmRise = await toneOf('rise within normal variation');
      const untestedRise = await toneOf('no test');
      expect([rise.sign, calmRise.sign, untestedRise.sign]).toEqual(['+', '+', '+']);
      expect([rise.tone, calmRise.tone, untestedRise.tone]).toEqual(['positive', 'neutral', 'neutral']);

      const fall = await toneOf('detectable fall');
      const calmFall = await toneOf('fall within normal variation');
      expect([fall.sign, calmFall.sign]).toEqual(['-', '-']);
      expect([fall.tone, calmFall.tone]).toEqual(['negative', 'neutral']);
    },
  );
});

describe('no source names a tone class', () => {
  const ROOT = resolve(process.cwd(), 'src');
  const FOLDERS = ['features/prompts/compare', 'lib/compare'];
  const FILES = [
    'features/prompts/columns/compare-columns.tsx',
    'features/prompts/prompts-strip.tsx',
    'features/prompts/rate-columns.tsx',
    'features/prompts/inspector-strip.tsx',
    'features/prompts/topic-inspector.tsx',
    'features/prompts/topic-drawer/prompt-row.tsx',
    'features/prompts/topic-drawer/engine-panel.tsx',
  ];
  const sources = [
    ...FOLDERS.flatMap((folder) =>
      readdirSync(resolve(ROOT, folder))
        .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
        .map((name) => `${folder}/${name}`),
    ),
    ...FILES,
  ];
  // The utility of a colour (`text-positive-text`, `bg-negative-subtle`, `text-green-600`) or the word for one
  const TONE_CLASS = /\b(?:text|bg|border|ring|fill|stroke)-(?:positive|negative|green|red)\b|\b(?:green|red)\b/;

  it('reads the files of the package, so a rename cannot empty the scan', () => {
    expect(sources).toEqual(expect.arrayContaining(['features/prompts/compare/change-inline.tsx']));
    expect(sources.length).toBeGreaterThan(15);
  });

  it.each(sources)('%s names no tone class (only Delta picks a colour)', (file) => {
    expect(readFileSync(resolve(ROOT, file), 'utf8')).not.toMatch(TONE_CLASS);
  });
});
