import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setTopicOrder } from './topic-order-store';
import { useTopicHeader } from './use-topic-header';
import { announce } from '@/lib/a11y/announcer';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import {
  cell,
  engine,
  projectEngine,
  promptRow,
  term,
  topicRow,
} from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import { DRAWER_TOPIC_ID, drawerExtras, renderDrawerPart } from '@/test/topic-drawer-harness';

vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

const PROJECT_ID = drawerExtras().scope.projectId;
const TREE = [term('seo', 'SEO'), term(DRAWER_TOPIC_ID, 'Technical SEO', 'seo', 'SEO / Technical SEO')];
const ROW: TopicSummaryRow = topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 12, [
  engine('chatgpt_web', { mentioned: cell(3, 8) }),
]);
const PROMPTS: PromptSummaryRow[] = [
  promptRow('p1', 'First', [DRAWER_TOPIC_ID]),
  promptRow('p2', 'Second', [DRAWER_TOPIC_ID]),
];

interface ProbeProps {
  topicKey?: string;
  row?: TopicSummaryRow | undefined;
  prompts?: readonly PromptSummaryRow[] | null;
}

/** Draws what the hook gives, so a test reads the header as the drawer would show it. */
function Probe({ topicKey = DRAWER_TOPIC_ID, row = ROW, prompts = PROMPTS }: ProbeProps): ReactElement {
  const header = useTopicHeader({ topicKey, row, prompts });
  return (
    <div>
      <div data-testid="badges">{header.badges}</div>
      <div data-testid="actions">{header.frequentAction}</div>
      <p data-testid="position">{header.positionText}</p>
      <div data-testid="freshness">{header.freshness}</div>
      {header.navigation === null ? null : (
        <>
          <button type="button" disabled={header.navigation.atFirst} onClick={header.navigation.onPrevious}>
            Previous topic
          </button>
          <button type="button" disabled={header.navigation.atLast} onClick={header.navigation.onNext}>
            Next topic
          </button>
        </>
      )}
      <button type="button" disabled={header.onStep === undefined} onClick={() => header.onStep?.('next')}>
        Key J
      </button>
      <button type="button" disabled={header.onStep === undefined} onClick={() => header.onStep?.('previous')}>
        Key K
      </button>
    </div>
  );
}

/** Thirteen topics as the table drew them, the open one third. */
const ORDER = ['a', 'b', DRAWER_TOPIC_ID, 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];

afterEach(() => {
  setTopicOrder(PROJECT_ID, null);
});

describe('useTopicHeader', () => {
  it('shows the category, prompt count and scope as badges, the prompt count text unchanged', () => {
    renderDrawerPart(<Probe />, { extras: { tree: TREE, country: 'DE', countryName: () => 'Germany' } });
    const badges = within(screen.getByTestId('badges'));
    expect(badges.getByText('SEO')).toBeInTheDocument();
    expect(badges.getByText('12 prompts')).toBeInTheDocument();
    expect(badges.getByText('2 engines, Germany, and Non-branded')).toBeInTheDocument();
    expect(
      badges.getByRole('group', { name: 'Scope of the counts: 2 engines, Germany, and Non-branded' }),
    ).toBeVisible();
  });

  it('says one engine by name and the branded choice', () => {
    renderDrawerPart(<Probe />, {
      engines: [projectEngine('gemini_web')],
      extras: { tree: TREE, includeBranded: true },
    });
    expect(screen.getByText('Gemini and Branded included')).toBeInTheDocument();
  });

  it('shows no category badge for a top level topic', () => {
    renderDrawerPart(<Probe topicKey="seo" row={topicRow('seo', 'SEO', 3)} />, { extras: { tree: TREE } });
    const badges = within(screen.getByTestId('badges'));
    expect(badges.queryByText('SEO')).not.toBeInTheDocument();
    expect(badges.getByText('3 prompts')).toBeInTheDocument();
  });

  it('the category badge takes the keyboard and its tooltip has the whole path', async () => {
    // The badge is the first thing the keyboard reaches: nothing before it in the probe takes focus
    const { user } = renderDrawerPart(<Probe />, { extras: { tree: TREE } });
    await user.tab();
    const badge = screen.getByText('SEO');
    expect(badge).toHaveFocus();
    // The tooltip's text is the badge's description, in the document whether the tooltip is open or not
    expect(badge).toHaveAccessibleDescription('Where the topic sits: SEO / Technical SEO');
  });

  it('Add prompt calls the screen with the topic, and is absent without prompts:write and for No topic', async () => {
    const onAddPrompt = vi.fn();
    const first = renderDrawerPart(<Probe />, { extras: { onAddPrompt } });
    await first.user.click(within(screen.getByTestId('actions')).getByRole('button', { name: 'Add prompt' }));
    expect(onAddPrompt).toHaveBeenCalledWith(DRAWER_TOPIC_ID);
    first.unmount();

    const readOnly = renderDrawerPart(<Probe />, { extras: { onAddPrompt: null } });
    expect(screen.queryByRole('button', { name: 'Add prompt' })).not.toBeInTheDocument();
    readOnly.unmount();

    // The prompts without a topic are no topic to add a prompt to
    renderDrawerPart(<Probe topicKey={NO_TOPIC} row={topicRow(null, null, 2)} />, {
      topicKey: NO_TOPIC,
      extras: { onAddPrompt },
    });
    expect(screen.queryByRole('button', { name: 'Add prompt' })).not.toBeInTheDocument();
  });

  it('Run now calls the screen with the prompt ids of the topic, and is absent without runs:trigger', async () => {
    const onRun = vi.fn();
    const { user, unmount } = renderDrawerPart(<Probe />, { extras: { run: { onRun, blockedReason: null } } });
    await user.click(screen.getByRole('button', { name: 'Run now' }));
    expect(onRun).toHaveBeenCalledWith(['p1', 'p2']);
    unmount();

    renderDrawerPart(<Probe />, { extras: { run: null } });
    expect(screen.queryByRole('button', { name: 'Run now' })).not.toBeInTheDocument();
  });

  it('Run now is disabled with its reason while another action runs', async () => {
    const onRun = vi.fn();
    const { user } = renderDrawerPart(<Probe />, {
      extras: { run: { onRun, blockedReason: 'A run is already on its way.' } },
    });
    const button = screen.getByRole('button', { name: 'Run now' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('A run is already on its way.');
    await user.click(button);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('Run now is disabled while the prompts of the topic are not known, and when it holds none', () => {
    const run = { onRun: vi.fn(), blockedReason: null };
    const { unmount } = renderDrawerPart(<Probe prompts={null} />, { extras: { run } });
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAccessibleDescription(
      'The prompts are still loading.',
    );
    unmount();

    renderDrawerPart(<Probe prompts={[]} />, { extras: { run } });
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAccessibleDescription(
      'This topic holds no prompt to run.',
    );
  });

  it('Run now gives the reason of the screen first, then that the prompts are loading, then that the topic is empty', () => {
    const blocked = { onRun: vi.fn(), blockedReason: 'A run is already on its way.' };
    const { unmount } = renderDrawerPart(<Probe prompts={null} />, { extras: { run: blocked } });
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAccessibleDescription('A run is already on its way.');
    unmount();

    const empty = renderDrawerPart(<Probe prompts={[]} />, { extras: { run: blocked } });
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAccessibleDescription('A run is already on its way.');
    empty.unmount();

    // With no reason of the screen, the prompts not being known comes first, then an empty topic
    const free = { onRun: vi.fn(), blockedReason: null };
    const loading = renderDrawerPart(<Probe prompts={null} />, { extras: { run: free } });
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAccessibleDescription(
      'The prompts are still loading.',
    );
    loading.unmount();
    renderDrawerPart(<Probe prompts={[]} />, { extras: { run: free } });
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAccessibleDescription(
      'This topic holds no prompt to run.',
    );
  });

  it('says 3 of 13 and steps with the buttons', async () => {
    setTopicOrder(PROJECT_ID, ORDER);
    const writes: string[] = [];
    const { user } = renderDrawerPart(<Probe />, {
      searchParams: `inspect=topic:${DRAWER_TOPIC_ID}&itab=prompts`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(screen.getByTestId('position')).toHaveTextContent('3 of 13');
    await user.click(screen.getByRole('button', { name: 'Next topic' }));
    expect(writes.at(-1)).toBe('?inspect=topic:d&itab=prompts');
    await user.click(screen.getByRole('button', { name: 'Previous topic' }));
    expect(writes.at(-1)).toBe(`?inspect=topic:${DRAWER_TOPIC_ID}&itab=prompts`);
  });

  it('J and K step to the next and previous topic and stop at the ends', async () => {
    const writes: string[] = [];
    setTopicOrder(PROJECT_ID, ['a', DRAWER_TOPIC_ID, 'c']);
    const { user, unmount } = renderDrawerPart(<Probe />, {
      searchParams: `inspect=topic:${DRAWER_TOPIC_ID}`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await user.click(screen.getByRole('button', { name: 'Key J' }));
    expect(writes.at(-1)).toBe('?inspect=topic:c');
    unmount();

    // On the last topic J does nothing, on the first K does nothing
    writes.length = 0;
    setTopicOrder(PROJECT_ID, ['a', 'b', DRAWER_TOPIC_ID]);
    const last = renderDrawerPart(<Probe />, {
      searchParams: `inspect=topic:${DRAWER_TOPIC_ID}`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await last.user.click(screen.getByRole('button', { name: 'Key J' }));
    expect(writes).toEqual([]);
    // The shared stepping says so, for a screen reader, instead of doing nothing
    expect(announce).toHaveBeenLastCalledWith('Last topic in this list', expect.anything());
    expect(screen.getByRole('button', { name: 'Next topic' })).toBeDisabled();
    last.unmount();

    setTopicOrder(PROJECT_ID, [DRAWER_TOPIC_ID, 'b']);
    const first = renderDrawerPart(<Probe />, {
      searchParams: `inspect=topic:${DRAWER_TOPIC_ID}`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await first.user.click(screen.getByRole('button', { name: 'Key K' }));
    expect(writes).toEqual([]);
    expect(announce).toHaveBeenLastCalledWith('First topic in this list', expect.anything());
  });

  it('announces the topic and its place after a step', async () => {
    setTopicOrder(PROJECT_ID, ['a', DRAWER_TOPIC_ID, 'c']);
    const { user } = renderDrawerPart(<Probe />, { searchParams: `inspect=topic:${DRAWER_TOPIC_ID}` });
    await user.click(screen.getByRole('button', { name: 'Key J' }));
    expect(announce).toHaveBeenLastCalledWith('Topic, 3 of 3', expect.anything());
  });

  it('has no counter or steps when the topic is not in the list', () => {
    setTopicOrder(PROJECT_ID, ['a', 'b']);
    const { unmount } = renderDrawerPart(<Probe />, { searchParams: `inspect=topic:${DRAWER_TOPIC_ID}` });
    expect(screen.getByTestId('position')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Next topic' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Key J' })).toBeDisabled();
    unmount();

    // No table has drawn the topics (a shared link): the same
    setTopicOrder(PROJECT_ID, null);
    renderDrawerPart(<Probe />, { searchParams: `inspect=topic:${DRAWER_TOPIC_ID}` });
    expect(screen.getByTestId('position')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Previous topic' })).not.toBeInTheDocument();
  });

  it('shows when the topic was last answered', () => {
    const answered = { ...ROW, last_observed_at: new Date(Date.now() - 2 * 3_600_000).toISOString() };
    const { unmount } = renderDrawerPart(<Probe row={answered} />);
    expect(screen.getByTestId('freshness')).toHaveTextContent('Updated 2h ago');
    unmount();

    renderDrawerPart(<Probe row={ROW} />);
    expect(screen.getByTestId('freshness')).toBeEmptyDOMElement();
  });
});
