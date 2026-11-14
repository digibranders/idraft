import { screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ComponentType, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { phaseOf, TopicCardFrame, useTopicEmpty, type PhaseWords, type TopicCardFrameProps } from './card-frame';
import type { TopicData } from './model-types';
import { topicData } from './topic-card-test-kit';
import messages from '../../../../../messages/en.json';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { OverviewProvider, useOverview, type OverviewScope } from '@/features/ai-overview';
import type { CardProps } from '@/features/layouts';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { cardInOverview, overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const WORDS: PhaseWords = {
  errorTitle: 'Topic heat map could not be read',
  errorReason: 'The server did not answer.',
  retryLabel: 'Try again',
  errorId: (id) => ({ id, label: `Error ID ${id}`, copyLabel: 'Copy error ID', copiedLabel: 'Copied' }),
  stale: 'These are the last figures read',
};

const stateOf = (over: Partial<TopicData>): Pick<TopicData, 'phase' | 'stale' | 'errorId' | 'retry' | 'settled'> => ({
  phase: 'ready',
  stale: false,
  errorId: null,
  retry: () => undefined,
  settled: true,
  ...over,
});

describe('phaseOf', () => {
  const run = (over: Partial<TopicData>, empty: Parameters<typeof phaseOf>[0]['empty'] = null) =>
    phaseOf({ data: stateOf(over), empty, words: WORDS });

  it('is loading while the first read runs, and a loading card has no notice', () => {
    expect(run({ phase: 'loading' })).toEqual({ phase: { status: 'loading' }, notice: undefined });
  });

  it('is ready with the data read', () => {
    expect(run({}).phase).toEqual({ status: 'ready' });
  });

  it('is refetching while a refetch runs', () => {
    expect(run({ phase: 'refetching' }).phase).toEqual({ status: 'refetching' });
  });

  it('is refetching while the windows are not settled', () => {
    expect(run({ phase: 'ready', settled: false }).phase).toEqual({ status: 'refetching' });
  });

  it('loading is not turned into refetching by an unsettled window', () => {
    expect(run({ phase: 'loading', settled: false }).phase).toEqual({ status: 'loading' });
  });

  it('is an error with the title, the request id and a retry that calls the read', () => {
    const retry = vi.fn();
    const { phase } = run({ phase: 'error', errorId: 'req-1', retry });
    if (phase.status !== 'error') throw new Error('expected the error phase');
    expect(phase.error.title).toBe('Topic heat map could not be read');
    expect(phase.error.errorId).toMatchObject({ id: 'req-1', label: 'Error ID req-1' });
    expect(phase.error.retryLabel).toBe('Try again');
    expect(phase.error.retrying).toBe(false);
    phase.error.onRetry();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('an error without a request id has no id', () => {
    const { phase } = run({ phase: 'error' });
    if (phase.status !== 'error') throw new Error('expected the error phase');
    expect(phase.error.errorId).toBeNull();
  });

  it('is empty when ready data is empty, also while it refetches', () => {
    const empty = { title: 'No topics', reason: 'Group prompts.', action: 'Open' };
    expect(run({}, empty).phase).toEqual({ status: 'empty', empty });
    expect(run({ phase: 'refetching' }, empty).phase).toEqual({ status: 'empty', empty });
  });

  it('is empty when nothing is asked (idle) and loading when idle has no words of its own', () => {
    const empty = { title: 'No engine', reason: 'None.', action: 'Open' };
    expect(run({ phase: 'idle' }, empty).phase).toEqual({ status: 'empty', empty });
    expect(run({ phase: 'idle' }).phase).toEqual({ status: 'loading' });
  });

  it('a read that failed to refresh keeps the data and says these are the last figures', () => {
    expect(run({ stale: true })).toEqual({
      phase: { status: 'ready' },
      notice: { kind: 'stale', text: 'These are the last figures read' },
    });
  });
});

const baseProps = (data: TopicData): TopicCardFrameProps => ({
  cardKey: 'ai.topic_heatmap',
  title: 'Topic heat map',
  meta: 'Oct 16 to Nov 12',
  summary: 'Mention rate of each topic on each engine.',
  data,
  empty: null,
  partialEngines: [],
  footnote: <p>Footnote text</p>,
  body: <p>Body text</p>,
  table: <p>Table text</p>,
});

interface Setup {
  over?: Partial<TopicData>;
  props?: (scope: OverviewScope) => Partial<TopicCardFrameProps>;
  world?: OverviewWorld;
  role?: Role;
  searchParams?: string;
}

function render({ over = {}, props, world = 'fynix', role = 'admin', searchParams = '' }: Setup = {}) {
  function Card(): ReactElement {
    const { scope } = useOverview();
    return <TopicCardFrame {...baseProps(topicData(scope, over))} {...props?.(scope)} />;
  }
  const updates: string[] = [];
  const view = renderWithProviders(
    cardInOverview({
      type: 'ai.topic_heatmap',
      Card: Card as ComponentType<CardProps>,
      width: 'two_thirds',
      world,
      role,
    }),
    {
      searchParams,
      onUrlUpdate: ({ queryString }) => {
        updates.push(queryString);
      },
    },
  );
  return { ...view, updates };
}

/** The frame is the card's own section: the page and the grid have sections of their own. */
const frameOf = async (): Promise<HTMLElement> => {
  const title = await screen.findByRole('heading', { name: 'Topic heat map' });
  const section = title.closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { name: 'Topic heat map' });

/** The frame under the provider alone, for a project whose page would not show an AI card. */
function bare(world: OverviewWorld, role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  function Card(): ReactElement {
    const { scope } = useOverview();
    return <TopicCardFrame {...baseProps(topicData(scope, { phase: 'idle' }))} />;
  }
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject(world)}
        >
          <Card />
        </OverviewProvider>
      </Suspense>
    </PermissionProvider>
  );
}

describe('TopicCardFrame', () => {
  it('loading is the frame skeleton at the card height', async () => {
    render({ over: { phase: 'loading' } });
    const frame = await frameOf();
    expect(frame.querySelector('[style*="height: 280px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Body text')).not.toBeInTheDocument();
  });

  it('the height follows the key of the card', async () => {
    render({ over: { phase: 'loading' }, props: () => ({ cardKey: 'ai.engine_disagreement' }) });
    const frame = await frameOf();
    expect(frame.querySelector('[style*="height: 180px"] [data-slot="skeleton"]')).not.toBeNull();
  });

  it('shows the title, the meta line, the body and the footnote of a ready card', async () => {
    render();
    await heading();
    expect(screen.getByText('Oct 16 to Nov 12')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });

  it('refetching keeps the body and sets the refetching status', async () => {
    render({ over: { phase: 'refetching' } });
    const frame = await frameOf();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    expect(frame).toHaveAttribute('aria-busy', 'true');
  });

  it('not settled is refetching', async () => {
    render({ over: { phase: 'ready', settled: false } });
    const frame = await frameOf();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
  });

  it('error shows the title, the request id and Retry that calls retry', async () => {
    const retry = vi.fn();
    const { user } = render({ over: { phase: 'error', errorId: 'req-77', retry } });
    expect(await screen.findByText('Topic heat map could not be read')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-77')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: messages.common.retry }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Body text')).not.toBeInTheDocument();
  });

  it('idle with the engine filter shows Use all engines and it clears the engine key', async () => {
    const { user, updates } = render({ over: { phase: 'idle' }, searchParams: 'engine=chatgpt_web' });
    expect(await screen.findByText('No engine is part of this view')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Use all engines' }));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(0);
    });
    expect(updates.at(-1)).not.toContain('engine=');
  });

  // A project with no engine on has no AI cards on its page, so the frame is rendered under the provider alone
  it('idle with canManageEngines and no engine on shows Turn on engines as a link', async () => {
    renderWithProviders(bare('cleanstart', 'admin'));
    const link = await screen.findByRole('link', { name: 'Turn on engines' });
    expect(link).toHaveAttribute('href', expect.stringMatching(/\/settings\/engines$/));
  });

  it('idle without the permission says to ask a workspace admin', async () => {
    renderWithProviders(bare('cleanstart', 'viewer'));
    expect(await screen.findByText(/ask a workspace admin/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Turn on engines' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use all engines' })).not.toBeInTheDocument();
  });

  it('stale shows the last figures read notice and keeps the body', async () => {
    render({ over: { stale: true } });
    await heading();
    expect(screen.getByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });

  it('partial names the engines without a valid answer', async () => {
    render({ props: () => ({ partialEngines: ['ChatGPT', 'Gemini'] }) });
    await heading();
    expect(
      screen.getByText('Partial data: ChatGPT and Gemini have no valid answer in this window'),
    ).toBeInTheDocument();
  });

  it('partial names one engine in the singular', async () => {
    render({ props: () => ({ partialEngines: ['Gemini'] }) });
    await heading();
    expect(screen.getByText('Partial data: Gemini has no valid answer in this window')).toBeInTheDocument();
  });

  it('stale wins over partial: one notice is shown and it is the older figures', async () => {
    render({ over: { stale: true }, props: () => ({ partialEngines: ['Gemini'] }) });
    await heading();
    expect(screen.getByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.queryByText(/Partial data/)).not.toBeInTheDocument();
  });

  it('an empty state has a reason and exactly one action', async () => {
    function EmptyCard(): ReactElement {
      const { scope } = useOverview();
      const empty = useTopicEmpty();
      return <TopicCardFrame {...baseProps(topicData(scope))} empty={empty.noTopics} />;
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.topic_heatmap', Card: EmptyCard as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    const state = (await screen.findByRole('heading', { name: 'No topics yet' })).closest('[data-slot="empty-state"]');
    expect(state).not.toBeNull();
    const box = within(state as HTMLElement);
    expect(box.getByText(/Group prompts into topics/)).toBeInTheDocument();
    expect([...box.queryAllByRole('link'), ...box.queryAllByRole('button')]).toHaveLength(1);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toHaveAttribute(
      'href',
      expect.stringContaining('/ai/prompts'),
    );
  });

  it('an empty state caused by the topic filter offers Clear topic', async () => {
    function EmptyCard(): ReactElement {
      const { scope } = useOverview();
      const empty = useTopicEmpty();
      return <TopicCardFrame {...baseProps(topicData(scope))} empty={empty.noTopics} />;
    }
    const updates: string[] = [];
    const { user } = renderWithProviders(
      cardInOverview({ type: 'ai.topic_heatmap', Card: EmptyCard as ComponentType<CardProps>, width: 'two_thirds' }),
      {
        searchParams: 'topic=3f2b0f0e-6b6c-4a6e-8a39-0d3c5a3d9a11',
        onUrlUpdate: ({ queryString }) => {
          updates.push(queryString);
        },
      },
    );
    await user.click(await screen.findByRole('button', { name: 'Clear topic' }));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(0);
    });
    expect(updates.at(-1)).not.toContain('topic=');
  });

  it('no valid answers names the engines and the days, with one action', async () => {
    function EmptyCard(): ReactElement {
      const { scope } = useOverview();
      const empty = useTopicEmpty();
      return <TopicCardFrame {...baseProps(topicData(scope))} empty={empty.noAnswers(['ChatGPT'], 28)} />;
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.topic_heatmap', Card: EmptyCard as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    const title = await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect([...box.queryAllByRole('link'), ...box.queryAllByRole('button')]).toHaveLength(1);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('the Table toggle shows the table form', async () => {
    const { user } = render();
    await heading();
    expect(screen.queryByText('Table text')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByText('Table text')).toBeInTheDocument();
    expect(screen.queryByText('Body text')).not.toBeInTheDocument();
  });

  it('the footnote is inside the frame', async () => {
    render();
    const title = await heading();
    expect(within(title.closest('section') as HTMLElement).getByText('Footnote text')).toBeInTheDocument();
  });

  it('puts the footer link under the body, and none without one', async () => {
    const href = projectPath('w', 'p', '/ai/prompts');
    const { unmount } = render({ props: () => ({ link: { href, label: 'Show all 12 topics' } }) });
    await heading();
    expect(screen.getByRole('link', { name: 'Show all 12 topics' })).toHaveAttribute('href', href);
    unmount();
    render({ props: () => ({ link: null }) });
    await heading();
    expect(screen.queryByRole('link', { name: /Show all/ })).not.toBeInTheDocument();
  });

  describe('export block', () => {
    const BLOCK = { id: 'card-under-test', header: ['topic'], rows: [['A']] };

    function renderExporting(over: Partial<TopicData>): () => ExportRead {
      let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
      function Reader(): null {
        reader = useExportBlocks();
        return null;
      }
      function ExportCard(): ReactElement {
        const { scope } = useOverview();
        return (
          <ExportProvider>
            <TopicCardFrame
              {...baseProps(topicData(scope, over))}
              exportBlock={{ id: 'card-under-test', build: () => BLOCK }}
            />
            <Reader />
          </ExportProvider>
        );
      }
      renderWithProviders(
        cardInOverview({ type: 'ai.topic_heatmap', Card: ExportCard as ComponentType<CardProps>, width: 'two_thirds' }),
      );
      return () => reader();
    }

    it('registers the block under the item id while the card is ready', async () => {
      const read = renderExporting({});
      await heading();
      expect(read()).toEqual({ blocks: [BLOCK], loading: 0 });
    });

    it('gives no block while the card loads, and the registry counts it as loading', async () => {
      const read = renderExporting({ phase: 'loading' });
      await heading();
      expect(read()).toEqual({ blocks: [], loading: 1 });
    });

    it('gives no block while the card shows an error', async () => {
      const read = renderExporting({ phase: 'error' });
      await heading();
      expect(read()).toEqual({ blocks: [], loading: 1 });
    });
  });

  it.each([
    ['ready', {}],
    ['loading', { phase: 'loading' }],
    ['refetching', { phase: 'refetching' }],
    ['error', { phase: 'error', errorId: 'req-1' }],
    ['idle', { phase: 'idle' }],
    ['stale', { stale: true }],
  ] as const)('axe has no violations when %s', async (_name, over) => {
    const { container } = render({ over });
    await heading();
    expect(await axe(container)).toHaveNoViolations();
  });
});
