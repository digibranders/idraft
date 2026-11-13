import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FactSentence, HowThisIsWritten } from './fact-sentences';
import type { Fact } from './facts-model';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const WINDOW = 'from=2026-10-16&to=2026-11-12';
const TYPE = 'ai.change_summary';

const engineChange = (over: Partial<Extract<Fact, { kind: 'engineChange' }>['params']> = {}): Fact => ({
  id: 'engineChange:chatgpt_web',
  kind: 'engineChange',
  params: {
    engine: 'chatgpt_web',
    rate: 0.34,
    k: 612,
    n: 1800,
    prompts: 250,
    delta: 0.021,
    before: 0.319,
    beforeK: 574,
    beforeN: 1800,
    ...over,
  },
  link: { destination: 'prompts', engine: 'chatgpt_web' },
});

/** Every kind of fact with the sentence its counts must give. */
const SENTENCES: readonly (readonly [fact: Fact, sentence: string])[] = [
  [
    { id: 'c', kind: 'collection', params: { engine: 'gemini_web', notValid: 38, all: 750, days: 28 }, link: null },
    'On Gemini, 38 of 750 answers were not valid in these 28 days.',
  ],
  [
    engineChange(),
    'ChatGPT mention rate is 34.0% (612 of 1,800 answers, 250 prompts), up 2.1 points from 31.9% (574 of 1,800 answers).',
  ],
  [
    engineChange({ rate: 0.3, delta: -0.021, before: 0.321, prompts: 1 }),
    'ChatGPT mention rate is 30.0% (612 of 1,800 answers, 1 prompt), down 2.1 points from 32.1% (574 of 1,800 answers).',
  ],
  [
    { id: 'w', kind: 'withinVariation', params: { engines: 1 }, link: null },
    'Mention rates moved within normal variation on 1 engine.',
  ],
  [
    { id: 'n1', kind: 'noPrevious', params: { reason: 'off', days: 28 }, link: null },
    'The comparison with the previous period is off, so nothing is said about change.',
  ],
  [
    { id: 'n2', kind: 'noPrevious', params: { reason: 'unread', days: 28 }, link: null },
    'The previous 28 days could not be read, so nothing is said about change.',
  ],
  [
    { id: 'n3', kind: 'noPrevious', params: { reason: 'noAnswers', days: 28 }, link: null },
    'There are no answers in the previous 28 days to compare with.',
  ],
  [
    { id: 'n4', kind: 'noPrevious', params: { reason: 'tooFew', days: 28 }, link: null },
    'There are too few answers in one of the two windows to compare mention rates.',
  ],
  [
    { id: 'n5', kind: 'noPrevious', params: { reason: 'noClaim', days: 28 }, link: null },
    'The mention rates of the two windows give no clear direction of change, so nothing is said about it.',
  ],
  [
    {
      id: 'g',
      kind: 'gainedLost',
      params: {
        engine: 'google_ai_mode',
        lost: 12,
        namedBefore: 90,
        gained: 7,
        notNamedBefore: 40,
        compared: 130,
        leftOut: 3,
      },
      link: null,
    },
    'On AI Mode, 12 of 90 prompts that named you before no longer do, and 7 of 40 prompts that did not name you before now do.',
  ],
  [
    {
      id: 'g1',
      kind: 'gainedLost',
      params: { engine: 'chatgpt_web', lost: 1, namedBefore: 1, gained: 0, notNamedBefore: 1, compared: 2, leftOut: 0 },
      link: null,
    },
    'On ChatGPT, 1 of 1 prompt that named you before no longer does, and 0 of 1 prompt that did not name you before now does.',
  ],
  [
    { id: 's', kind: 'newSources', params: { count: 37, minSupport: 2, days: 28 }, link: null },
    '37 domains were cited for the first time, with at least 2 citation units each in these 28 days and none in the 28 days before.',
  ],
  [
    { id: 's1', kind: 'newSources', params: { count: 1, minSupport: 1, days: 1 }, link: null },
    '1 domain was cited for the first time, with at least 1 citation unit each in this 1 day and none in the 1 day before.',
  ],
];

function Probe(): ReactElement {
  return (
    <>
      <ol>
        {SENTENCES.map(([fact], index) => (
          <li key={`${fact.id}-${String(index)}`}>
            <FactSentence fact={fact} />
          </li>
        ))}
      </ol>
      <HowThisIsWritten />
    </>
  );
}

const render = (searchParams: string = WINDOW): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(cardInOverview({ type: TYPE, Card: Probe, width: 'full' }), { searchParams });

const lines = async (): Promise<HTMLElement[]> => {
  const list = (await screen.findAllByRole('list')).find((entry) => entry.tagName === 'OL');
  if (list === undefined) throw new Error('The facts are not listed');
  return within(list).getAllByRole('listitem');
};

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FactSentence', () => {
  it('renders the sentence of every fact kind with its counts', async () => {
    render();
    const items = await lines();
    expect(items.map((item) => item.textContent)).toEqual(SENTENCES.map(([, sentence]) => sentence));
  });

  it('links the figure of an engine change through the card drill, to the Prompts page with the engine', async () => {
    render();
    const [, up] = await lines();
    const link = within(up as HTMLElement).getByRole('link');
    expect(link).toHaveTextContent('34.0% (612 of 1,800 answers, 250 prompts)');
    expect(link.getAttribute('href')).toContain('/prompts?');
    expect(link.getAttribute('href')).toContain('engine=chatgpt_web');
  });

  it('is plain text, with the same words, where the drill gives no link', async () => {
    // The Prompts page cannot show "branded prompts only": the drill answers null
    render(`${WINDOW}&branded=only`);
    const [, up] = await lines();
    expect(within(up as HTMLElement).queryByRole('link')).toBeNull();
    expect(up).toHaveTextContent(SENTENCES[1]?.[1] ?? 'missing');
  });
});

describe('HowThisIsWritten', () => {
  it('opens a popover with the rules in plain words and closes with Escape', async () => {
    const { user } = render();
    await lines();
    const button = screen.getByRole('button', { name: 'How this is written' });
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'How this is written' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(5);
    expect(dialog).toHaveTextContent('No sentence names a cause or judges a change, and engines are never pooled.');
    expect(dialog).toHaveTextContent('Answers that were not valid come first');
    expect(dialog).toHaveTextContent('A prompt names you when at least one of its valid answers does.');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(button).toHaveFocus();
  });
});
