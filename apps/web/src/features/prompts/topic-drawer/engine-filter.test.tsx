import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EngineFilteredPrompts } from './engine-filter';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { cell, engine, promptRow } from '@/features/prompts/topics-by-engine/cells-fixtures';
import { DRAWER_ENTRY_KEYS } from '@/features/prompts/topics-by-engine/drill';
import type { PromptSummaryRow } from '@/lib/api/types';
import { DRAWER_TOPIC_ID, renderDrawerPart } from '@/test/topic-drawer-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

const onChatgpt = (k: number, n: number) =>
  engine('chatgpt_web', { mentioned: cell(k, n), cited: cell(Math.min(k, 1), n) });
const onGemini = engine('gemini_web', { mentioned: cell(2, 4) });

const HIGH = promptRow('high', 'Best prompt', [], [onChatgpt(5, 5)]);
const MID = promptRow('mid', 'Middle prompt', [], [onChatgpt(3, 5), onGemini]);
const GEMINI_ONLY = promptRow('gem', 'Gemini only prompt', [], [onGemini]);
const PROMPTS: PromptSummaryRow[] = [GEMINI_ONLY, MID, HIGH];

/** What the drawer draws for the unfiltered list: the test stands in for its `PromptList`. */
const everything = (prompts: readonly PromptSummaryRow[]) => (
  <ul aria-label="Every engine list">
    {prompts.map((prompt) => (
      <li key={prompt.prompt_id}>{prompt.text}</li>
    ))}
  </ul>
);

const renderFilter = (searchParams = '', prompts: readonly PromptSummaryRow[] = PROMPTS, onOpen = vi.fn()) => ({
  onOpen,
  ...renderDrawerPart(<EngineFilteredPrompts prompts={prompts} onOpen={onOpen} renderList={everything} />, {
    searchParams,
  }),
});

describe('EngineFilteredPrompts: the Prompts tab of a topic', () => {
  it('lists every prompt without eng, with no chip', () => {
    renderFilter();
    const list = screen.getByRole('list', { name: 'Every engine list' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(/Engine: /)).not.toBeInTheDocument();
  });

  it('shows the chip and only the prompts of that engine with eng, high to low, and says how many it hides', () => {
    renderFilter('eng=chatgpt_web');
    expect(screen.getByText('Engine: ChatGPT')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Best prompt');
    expect(rows[1]).toHaveTextContent('Middle prompt');
    expect(screen.queryByText('Gemini only prompt')).not.toBeInTheDocument();
    expect(screen.getByText('2 prompts have answers on ChatGPT, ordered by Mention.')).toBeInTheDocument();
    expect(screen.getByText('1 prompt is hidden: it has no answer on ChatGPT.')).toBeInTheDocument();
  });

  it('says nothing of hidden prompts when every prompt has an answer on the engine', () => {
    renderFilter('eng=chatgpt_web', [HIGH, MID]);
    expect(screen.getByText('2 prompts have answers on ChatGPT, ordered by Mention.')).toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
  });

  it('each row shows the value and k of n on that engine, never the other engines', () => {
    renderFilter('eng=chatgpt_web');
    const [best, middle] = screen.getAllByRole('listitem');
    expect(best).toHaveTextContent('ChatGPT: 100%, 5 of 5 answers');
    expect(middle).toHaveTextContent('ChatGPT: 60%, 3 of 5 answers');
    expect(middle).not.toHaveTextContent('Gemini');
  });

  it('orders by the chosen metric and names it', () => {
    renderFilter('eng=chatgpt_web&metric=citation');
    expect(screen.getByText('2 prompts have answers on ChatGPT, ordered by Citation.')).toBeInTheDocument();
    const [best] = screen.getAllByRole('listitem');
    expect(best).toHaveTextContent('ChatGPT: 20%, 1 of 5 answers');
  });

  it('says too few answers where the engine has too few for a rate', () => {
    const thin = promptRow('thin', 'Thin prompt', [], [engine('chatgpt_web', { mentioned: cell(1, 2) })]);
    renderFilter('eng=chatgpt_web', [thin]);
    expect(screen.getByRole('listitem')).toHaveTextContent('ChatGPT: too few answers (2), 1 of 2 answers');
  });

  it('opens a prompt', async () => {
    const { user, onOpen } = renderFilter('eng=chatgpt_web');
    await user.click(screen.getByRole('button', { name: 'Best prompt' }));
    expect(onOpen).toHaveBeenCalledWith('high');
  });

  it('drops an eng that is not an engine shown, and lists every prompt', () => {
    renderFilter('eng=perplexity');
    expect(screen.queryByText(/Engine: /)).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Every engine list' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('the chip removes the filter', async () => {
    const writes: string[] = [];
    const { user } = renderDrawerPart(
      <EngineFilteredPrompts prompts={PROMPTS} onOpen={vi.fn()} renderList={everything} />,
      { searchParams: 'metric=citation&eng=chatgpt_web', onUrlUpdate: ({ queryString }) => writes.push(queryString) },
    );
    await user.click(screen.getByRole('button', { name: 'Show every engine' }));
    expect(writes.at(-1)).toBe('?metric=citation');
    expect(screen.queryByText(/Engine: /)).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Every engine list' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('says no prompt has an answer on the engine', () => {
    renderFilter('eng=chatgpt_web', [GEMINI_ONLY]);
    expect(screen.getByRole('heading', { name: 'No prompt has an answer on ChatGPT' })).toBeInTheDocument();
    expect(screen.getByText('Show every engine to list the prompts of this topic.')).toBeInTheDocument();
    // The chip stays, so the filter can be removed from here
    expect(screen.getByRole('button', { name: 'Show every engine' })).toBeInTheDocument();
  });

  it('drops eng with the drawer, so a close removes the chip and the key in one write', async () => {
    const writes: string[] = [];
    function Probe(): ReactElement {
      const inspector = useInspector({ entryKeys: DRAWER_ENTRY_KEYS });
      return (
        <button type="button" onClick={() => inspector.close()}>
          Close the drawer
        </button>
      );
    }
    const { user } = renderDrawerPart(
      <>
        <Probe />
        <EngineFilteredPrompts prompts={PROMPTS} onOpen={vi.fn()} renderList={everything} />
      </>,
      {
        searchParams: `inspect=topic:${DRAWER_TOPIC_ID}&itab=prompts&eng=chatgpt_web`,
        onUrlUpdate: ({ queryString }) => writes.push(queryString),
      },
    );
    expect(screen.getByText('Engine: ChatGPT')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close the drawer' }));
    expect(writes).toEqual(['']);
    expect(screen.queryByText(/Engine: /)).not.toBeInTheDocument();
  });
});
