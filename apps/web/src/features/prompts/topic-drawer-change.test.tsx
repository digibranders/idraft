import { screen, waitFor, within } from '@testing-library/react';
import { vi, describe, expect, it } from 'vitest';

import { ComparedWindowProvider } from './compare/compared-window';
import { TopicInspector } from './topic-inspector';
import { cell, engine, projectEngine, promptRow, topicRow, weighted } from './topics-by-engine/cells-fixtures';
import type { EngineSummary, MetricCell, PromptSummaryRow } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';
// The drawer reads the entities and the tracked keywords: the harness answers both with none
import { DRAWER_TOPIC_ID, READY_COUNTS, drawerExtras, summaryOf } from '@/test/topic-drawer-harness';

// jsdom has no canvas: the drawer's charts are drawn as an empty box
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

// The engine panel builds its links from the address the page is on
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

const WINDOW = { from: '2026-09-18', to: '2026-10-15' };
const ENGINES = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];

interface Pair {
  now: MetricCell;
  before: MetricCell;
}

/** An engine of the topic row with the three metrics now and before; `null` for before leaves the period without answers. */
const topicEngine = (code: string, mentioned: Pair, cited: Pair, share: Pair, hasPrevious = true): EngineSummary =>
  engine(code, {
    mentioned: mentioned.now,
    cited: cited.now,
    share_of_voice: share.now,
    previous: hasPrevious ? { mentioned: mentioned.before, cited: cited.before, share_of_voice: share.before } : null,
  });

const pair = (now: MetricCell, before: MetricCell): Pair => ({ now, before });

/** ChatGPT 30 of 60 against 12 of 60 and Gemini 40 of 80 against 20 of 80: the average rose 27.5 points, detectable. */
const TOPIC_ENGINES = (geminiHasPrevious = true): EngineSummary[] => [
  topicEngine(
    'chatgpt_web',
    pair(weighted(30, 60, 3), weighted(12, 60, 3)),
    pair(weighted(31, 60, 3), weighted(27, 60, 3)),
    pair(weighted(30, 60, 3), weighted(18, 60, 3)),
  ),
  topicEngine(
    'gemini_web',
    pair(weighted(40, 80, 3), weighted(20, 80, 3)),
    pair(weighted(41, 80, 3), weighted(36, 80, 3)),
    pair(weighted(40, 80, 3), weighted(40, 80, 3)),
    geminiHasPrevious,
  ),
];

const promptOf = (id: string, engines: readonly EngineSummary[]): PromptSummaryRow =>
  promptRow(id, `Prompt ${id}`, [DRAWER_TOPIC_ID], engines);

const promptEngine = (code: string, now: MetricCell, before: MetricCell | null): EngineSummary =>
  engine(code, { mentioned: now, previous: before === null ? null : { mentioned: before } });

/** Three prompts that rose on both engines, one whose previous period has 3 answers, and one that moved apart. */
const PROMPTS: PromptSummaryRow[] = [
  promptOf('rose', [
    promptEngine('chatgpt_web', cell(30, 60), cell(12, 60)),
    promptEngine('gemini_web', cell(40, 80), cell(20, 80)),
  ]),
  promptOf('few', [
    promptEngine('chatgpt_web', cell(30, 60), cell(1, 3)),
    promptEngine('gemini_web', cell(40, 80), cell(1, 3)),
  ]),
  // The engines' average rose 20 points while their pooled answers fell: no test is claimed
  promptOf('apart', [
    promptEngine('chatgpt_web', cell(4, 4), cell(2, 4)),
    promptEngine('gemini_web', cell(20, 200), cell(40, 200)),
  ]),
];

const DESCENDANTS = new Map([[DRAWER_TOPIC_ID, new Set([DRAWER_TOPIC_ID])]]);

interface Options {
  engines?: EngineSummary[];
  prompts?: PromptSummaryRow[];
  searchParams?: string;
  tab?: string;
  onTabChange?: (tab: string) => void;
}

function renderDrawer({
  engines = TOPIC_ENGINES(),
  prompts = PROMPTS,
  searchParams = '',
  tab = 'overview',
  onTabChange = () => undefined,
}: Options = {}): ProvidedRender {
  const summary = { ...summaryOf([topicRow(DRAWER_TOPIC_ID, 'Paid Search', prompts.length, engines)]), prompts };
  return renderWithProviders(
    <ComparedWindowProvider value={WINDOW}>
      <TopicInspector
        topicKey={DRAWER_TOPIC_ID}
        summary={summary}
        counts={READY_COUNTS}
        engines={ENGINES}
        descendants={DESCENDANTS}
        treeName="Paid Search"
        treePending={false}
        extras={drawerExtras()}
        tab={tab}
        onTabChange={onTabChange}
        onOpenPrompt={() => undefined}
        onClose={() => undefined}
      />
    </ComparedWindowProvider>,
    { searchParams },
  );
}

/** The value of a card: the `dd` of its label. */
const valueOf = async (label: string): Promise<HTMLElement> => {
  const term = await screen.findByText(label, { selector: 'dt' });
  const value = term.parentElement?.querySelector('dd');
  if (value === null || value === undefined) throw new Error(`The ${label} card is missing`);
  return value;
};
/** The tab stop of a card, which holds the tooltip. */
const stopOf = (card: HTMLElement): HTMLElement => {
  const stop = card.querySelector<HTMLElement>('[tabindex="0"]');
  if (stop === null) throw new Error('The card has no tab stop');
  return stop;
};
const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');
const sectionOf = async (name: string): Promise<HTMLElement> => {
  const section = (await screen.findByRole('heading', { name })).closest('section');
  if (section === null) throw new Error(`The ${name} section is missing`);
  return section;
};
const itemOf = (section: HTMLElement, id: string): HTMLElement => {
  const item = within(section).getByText(`Prompt ${id}`).closest('li');
  if (item === null) throw new Error(`The prompt ${id} is missing`);
  return item;
};

describe('the topic drawer: change on the three cards', () => {
  it('shows the change of the average beside "avg of 2", coloured only when it is detectable', async () => {
    renderDrawer();
    const mentioned = await valueOf('Mentioned');
    expect(mentioned).toHaveTextContent('avg of 2');
    expect(within(mentioned).getByText('+27.5 pts')).toHaveClass('text-positive-text');
    expect(mentioned).toHaveTextContent('up 27.5 pts, detectable, interim test');
    const cited = await valueOf('Cited');
    const delta = within(cited).getByText('+6.5 pts');
    expect(delta).toHaveClass('text-foreground-secondary');
    expect(delta).not.toHaveClass('text-positive-text');
    expect(cited).toHaveTextContent('within normal variation, interim test');
  });

  it('holds the previous average, the engine count, the window and the verdict in a tooltip that is a tab stop', async () => {
    const { user } = renderDrawer();
    const stop = stopOf(await valueOf('Mentioned'));
    await user.hover(stop);
    await waitFor(() => expect(tooltip()).toHaveTextContent('Average of 2 engines that have a rate in both periods'));
    expect(tooltip()).toHaveTextContent('tested on pooled answers');
    expect(tooltip()).toHaveTextContent('Previous 23%, 32 of 140 answers');
    expect(tooltip()).toHaveTextContent('Previous period: Sep 18 to Oct 15');
    expect(tooltip()).toHaveTextContent('Detectable change');
    expect(tooltip()).toHaveTextContent('Interim test');
    expect(tooltip()?.textContent).not.toMatch(/\.$/);
  });

  it('takes only the engines that have a rate in both periods, and names the one engine', async () => {
    const { user } = renderDrawer({ engines: TOPIC_ENGINES(false) });
    const mentioned = await valueOf('Mentioned');
    // The average shown is over both engines, the change is ChatGPT's alone
    expect(mentioned).toHaveTextContent('avg of 2');
    expect(within(mentioned).getByText('+30.0 pts')).toBeInTheDocument();
    await user.hover(stopOf(mentioned));
    await waitFor(() =>
      expect(tooltip()).toHaveTextContent('Change of ChatGPT only, the one engine with a rate in both periods'),
    );
    expect(tooltip()).toHaveTextContent('Previous 20%, 12 of 60 answers');
  });

  it('draws the change of Share of voice neutral and says in its tooltip that no test exists', async () => {
    const { user } = renderDrawer();
    const share = await valueOf('Share of voice');
    const delta = within(share).getByText('+10.0 pts');
    expect(delta).toHaveClass('text-foreground-secondary');
    expect(delta).not.toHaveClass('text-positive-text');
    expect(share.textContent).not.toMatch(/detectable|within normal variation|interim test/);
    await user.hover(stopOf(share));
    await waitFor(() =>
      expect(tooltip()).toHaveTextContent('No test exists for share of voice, so its change is not coloured'),
    );
    expect(tooltip()?.textContent).not.toMatch(/Detectable change|Within normal variation|Interim test/);
  });

  it('shows nothing for a topic with no previous period, and its tooltip says so', async () => {
    const { user } = renderDrawer({
      engines: [
        topicEngine(
          'chatgpt_web',
          pair(weighted(30, 60, 3), weighted(0, 0, 0)),
          pair(weighted(30, 60, 3), weighted(0, 0, 0)),
          pair(weighted(30, 60, 3), weighted(0, 0, 0)),
          false,
        ),
      ],
    });
    const mentioned = await valueOf('Mentioned');
    expect(mentioned.textContent).not.toMatch(/\d pts/);
    await user.hover(stopOf(mentioned));
    await waitFor(() => expect(tooltip()).toHaveTextContent('No answers in the previous period'));
  });

  it('draws no change and no tab stop without comparison', async () => {
    renderDrawer({ searchParams: '?cmp=off' });
    const mentioned = await valueOf('Mentioned');
    expect(mentioned).toHaveTextContent('avg of 2');
    expect(mentioned.textContent).not.toMatch(/\d pts/);
    expect(mentioned.querySelector('[tabindex="0"]')).toBeNull();
  });

  it('has no accessibility violation with the changes', async () => {
    const { container } = renderDrawer();
    await valueOf('Mentioned');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the topic drawer: change on the prompts', () => {
  it('shows each top prompt Mention change after its counts, and leaves out one whose previous has under 4 answers', async () => {
    renderDrawer();
    const top = await sectionOf('Top prompts');
    const rose = itemOf(top, 'rose');
    expect(within(rose).getByText('+27.5 pts')).toHaveClass('text-positive-text');
    expect(rose.textContent?.indexOf('Gemini mentioned')).toBeLessThan(rose.textContent?.indexOf('up 27.5 pts') ?? -1);
    expect(itemOf(top, 'few').textContent).not.toMatch(/\d pts/);
  });

  it('makes no claim for a prompt whose engines and pooled answers move apart, and says why', async () => {
    const { user } = renderDrawer();
    const apart = itemOf(await sectionOf('Top prompts'), 'apart');
    const delta = within(apart).getByText('+20.0 pts');
    expect(delta).toHaveClass('text-foreground-secondary');
    expect(apart.textContent).not.toMatch(/detectable|interim test/);
    await user.hover(within(apart).getByText('+20.0 pts').closest('[tabindex="0"]') ?? apart);
    await waitFor(() => expect(tooltip()).toHaveTextContent('This change is not tested because'));
  });

  it('holds the previous value in the tooltip of a prompt change', async () => {
    const { user } = renderDrawer();
    const rose = itemOf(await sectionOf('Top prompts'), 'rose');
    // The prompt's own button is a tab stop too: the change's is the one around its text
    const stop = within(rose).getByText('+27.5 pts').closest<HTMLElement>('[tabindex="0"]');
    expect(stop).not.toBeNull();
    if (stop !== null) await user.hover(stop);
    await waitFor(() => expect(tooltip()).toHaveTextContent('Previous 23%, 32 of 140 answers'));
    expect(tooltip()).toHaveTextContent('Previous period: Sep 18 to Oct 15');
  });

  it('shows the same change on the Prompts tab', async () => {
    renderDrawer({ tab: 'prompts' });
    const list = await sectionOf('Prompts');
    expect(within(itemOf(list, 'rose')).getByText('+27.5 pts')).toBeInTheDocument();
    expect(itemOf(list, 'few').textContent).not.toMatch(/\d pts/);
  });

  it('keeps Show all opening the Prompts tab', async () => {
    const many = Array.from({ length: 6 }, (_, index) => promptOf(`n${String(index)}`, PROMPTS[0]?.engines ?? []));
    const onTabChange = vi.fn();
    const { user } = renderDrawer({ prompts: many, onTabChange });
    await user.click(await screen.findByRole('button', { name: 'Show all 6 prompts' }));
    expect(onTabChange).toHaveBeenCalledWith('prompts');
  });

  it('draws no prompt change without comparison', async () => {
    renderDrawer({ searchParams: '?cmp=off' });
    const top = await sectionOf('Top prompts');
    expect(top.textContent).not.toMatch(/\d pts/);
    // Only the prompt's own buttons are tab stops: the meta line has none
    expect(top.querySelector('p [tabindex="0"]')).toBeNull();
  });
});
