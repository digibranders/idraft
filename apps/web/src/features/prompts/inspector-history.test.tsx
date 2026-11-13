import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorHistory, type InspectorHistoryProps } from './inspector-history';
import type { PromptAnswers, PromptCounts } from './inspector-reads';
import type { ObservationSummary, ProjectEngine } from '@/lib/api/types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const LABELS: Record<string, string> = { chatgpt_web: 'ChatGPT', gemini_web: 'Gemini' };

const engine = (code: 'chatgpt_web' | 'gemini_web'): ProjectEngine => ({
  active_prompts: 1,
  engine: ENGINE_FACTS[code],
  estimated_monthly_cost_usd: null,
  is_configured: true,
  is_enabled: true,
  location_ids: [2276],
  provider_code: 'openai',
  replicates: 1,
});

const answer = (id: string, code: string, observedAt: string): ObservationSummary =>
  ({
    observation_id: id,
    engine_code: code,
    observed_at: observedAt,
    status: 'complete',
    model_reported: null,
    facts: { is_valid: true, outcome: 'neither' },
  }) as unknown as ObservationSummary;

const noCounts: PromptCounts = {
  status: 'ready',
  row: undefined,
  entities: [],
  brandedIncluded: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
};

const answersOf = (rows: readonly ObservationSummary[], status: PromptAnswers['status'] = 'ready'): PromptAnswers => ({
  status,
  rows,
  hasMore: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

/** ChatGPT answers every 3 days of the window; Gemini on Oct 20 and Oct 30 only. */
const ROWS = [
  ...Array.from({ length: 11 }, (_, at) =>
    answer(`c${String(at)}`, 'chatgpt_web', new Date(Date.UTC(2026, 9, 1 + at * 3, 2)).toISOString()),
  ),
  answer('g1', 'gemini_web', '2026-10-20T02:00:00Z'),
  answer('g2', 'gemini_web', '2026-10-30T02:00:00Z'),
];

function renderHistory(over: Partial<InspectorHistoryProps> = {}): ProvidedRender {
  const ui: ReactElement = (
    <InspectorHistory
      counts={noCounts}
      engines={[engine('chatgpt_web'), engine('gemini_web')]}
      range={{ from: '2026-10-01', to: '2026-11-02' }}
      timeZone="UTC"
      createdAt="2026-09-01T09:00:00Z"
      answers={answersOf(ROWS)}
      labelOf={(code) => LABELS[code] ?? code}
      noCountsReason="No counts"
      onOpenAnswer={undefined}
      {...over}
    />
  );
  return renderWithProviders(ui);
}

const events = (): HTMLElement => screen.getByRole('list', { name: 'Events of this prompt' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the events of the History tab', () => {
  it('lists a stale engine with its days and its date, newest first among the events', () => {
    renderHistory();
    const items = within(events()).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Oct 20'),
      expect.stringContaining('Sep 1'),
    ]);
    expect(items[0]).toHaveTextContent('No valid answer on Gemini for 10 days');
    expect(items[1]).toHaveTextContent('Prompt added');
    // ChatGPT answers every 3 days: not stale
    expect(within(events()).queryByText(/on ChatGPT/)).toBeNull();
  });

  it('measures the last gap to now when the window reaches past it', () => {
    // The window runs to Nov 30, but it is Nov 6, 02:00: 7 days since the last Gemini answer of Oct 30
    vi.setSystemTime(new Date('2026-11-06T02:00:00Z'));
    renderHistory({ range: { from: '2026-10-01', to: '2026-11-30' } });
    expect(within(events()).getByText('No valid answer on Gemini for 7 days')).toBeInTheDocument();
    // Measured to the end of the window it would be 31 days
    expect(within(events()).queryByText(/for 31 days/)).toBeNull();
  });

  it('gives an engine with no valid answer in the window one event from the start of the window', () => {
    renderHistory({ answers: answersOf(ROWS.filter((row) => row.engine_code === 'chatgpt_web')) });
    expect(within(events()).getByText('No valid answer on Gemini for 33 days')).toBeInTheDocument();
  });

  it('adds no stale event while the answers are loading or failed to load', () => {
    const first = renderHistory({ answers: answersOf([], 'loading') });
    expect(screen.queryByText(/No valid answer on/)).toBeNull();
    first.unmount();
    renderHistory({ answers: answersOf([], 'error') });
    expect(screen.queryByText(/No valid answer on/)).toBeNull();
  });

  it('adds no stale event for the days before the prompt was added', () => {
    renderHistory({ answers: answersOf([]), createdAt: '2026-10-30T09:00:00Z' });
    expect(screen.queryByText(/No valid answer on/)).toBeNull();
  });
});
