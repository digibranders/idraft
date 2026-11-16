import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { projectEngine } from '../compare/change-test-data';
import { indexFacts } from '../facts';
import { cellOf, engine } from '../facts/test-helpers';
import { usePromptColumns, type PromptRow } from '../prompt-columns';
import { renderWithProviders } from '@/test/render';
import type { PromptsSummaryWithFacts } from '@/lib/api/prompt-facts';
import type { Prompt, PromptSummaryRow } from '@/lib/api/types';

const prompt = { prompt_id: 'p1', intent: 'commercial', is_branded: false, terms: [] } as unknown as Prompt;
const summaryRow = {
  prompt_id: 'p1',
  topic_term_ids: [],
  engines: [engine('chatgpt_web')],
} as unknown as PromptSummaryRow;

const FACTS = indexFacts(
  {
    prompts: [
      {
        ...summaryRow,
        linked_keyword: { keyword: 'crm software', search_volume: 1190 },
        engines: [
          engine('chatgpt_web', {
            valid: 12,
            position: { rank_sum: 9, ordered_answers: 4, mentions: 6, answers: 12 },
            recommended: cellOf(6, 12),
            sentiment: { positive: 8, neutral: 3, negative: 1, mixed: 0 },
          }),
        ],
      },
    ],
    topics: [],
    entities: [],
    engine_codes: ['chatgpt_web'],
  } as unknown as PromptsSummaryWithFacts,
  true,
);

const ROW: PromptRow = {
  prompt,
  summary: summaryRow,
  countsLoaded: true,
  topics: null,
  topicList: [],
  country: null,
};

const METRICS = ['intent', 'volume', 'position', 'recommendation', 'sov', 'sentiment'];

function Probe({ withFacts, row = ROW }: { withFacts: boolean; row?: PromptRow }): ReactElement {
  const { columns, sortFields } = usePromptColumns([projectEngine('chatgpt_web')], 'mention', null, {
    showLocation: true,
    facts: withFacts ? FACTS : undefined,
    project: { workspaceId: 'workspace', projectId: 'project' },
    timeZone: 'UTC',
  });
  return (
    <>
      <p data-testid="ids">{columns.map((column) => column.id).join(' ')}</p>
      <p data-testid="sorts">{[...sortFields].join(' ')}</p>
      {columns
        .filter((column) => METRICS.includes(column.id))
        .map((column) => (
          <div key={column.id} data-testid={`cell-${column.id}`}>
            {column.cell(row)}
          </div>
        ))}
    </>
  );
}

describe('the metric columns on the Prompts tab', () => {
  it('sit in the mock order: identity block, Intent, Search volume, Mention position, rates, Recommendation rate, Share of voice, Sentiment', () => {
    renderWithProviders(<Probe withFacts />);
    const ids = (screen.getByTestId('ids').textContent ?? '').split(' ');
    expect(ids.slice(0, 11)).toEqual([
      'prompt',
      'topic',
      'country',
      'intent',
      'volume',
      'position',
      'mention',
      'citation',
      'recommendation',
      'sov',
      'sentiment',
    ]);
  });

  it('all sort, so a `?sort=` names them', () => {
    renderWithProviders(<Probe withFacts />);
    const sorts = (screen.getByTestId('sorts').textContent ?? '').split(' ');
    expect(sorts).toEqual(
      expect.arrayContaining(['intent', 'volume', 'position', 'recommendation', 'sov', 'sentiment']),
    );
  });

  it('draw their cells from the facts of the summary read', () => {
    renderWithProviders(<Probe withFacts />);
    const text = (id: string): string | null => screen.getByTestId(`cell-${id}`).textContent;
    expect(text('intent')).toBe('Commercial');
    expect(text('volume')).toBe('1,190');
    expect(text('position')).toBe('2.3');
    expect(text('recommendation')).toBe('50%');
    expect(text('sentiment')).toBe('67%positive');
    // Share of voice comes from the summary's own cells, which the fixture row leaves empty
    expect(text('sov')).toBe('n/a');
  });

  it('say n/a, never a number, while the facts are not read', () => {
    renderWithProviders(<Probe withFacts={false} />);
    const text = (id: string): string | null => screen.getByTestId(`cell-${id}`).textContent;
    expect(['volume', 'position', 'recommendation', 'sentiment'].map(text)).toEqual(['n/a', 'n/a', 'n/a', 'n/a']);
    expect(text('intent')).toBe('Commercial');
  });

  it('say the prompt has no answers when the facts were read and hold no row for it', () => {
    const unknownPrompt = { ...ROW, prompt: { ...prompt, prompt_id: 'p2' } };
    renderWithProviders(<Probe withFacts row={unknownPrompt} />);
    const text = (id: string): string | null => screen.getByTestId(`cell-${id}`).textContent;
    expect(['position', 'recommendation', 'sentiment'].map(text)).toEqual(['n/a', 'n/a', 'n/a']);
    // The reason is the cell's tooltip: not "Not collected yet"
    expect(screen.getByTestId('cell-position')).not.toHaveTextContent('Not collected');
  });
});
