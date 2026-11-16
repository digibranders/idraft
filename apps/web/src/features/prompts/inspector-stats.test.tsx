import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InspectorStats } from './inspector-stats';
import type { PromptCounts } from './inspector-reads';
import type { EngineSummary, MetricCell, ProjectEngine, PromptSummaryRow } from '@/lib/api/types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

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

const cell = (k: number, n: number): MetricCell => ({
  numerator: k,
  denominator: n,
  n_observations: n,
  value: n === 0 ? null : k / n,
});

const summary = (code: string, mentioned: MetricCell, cited: MetricCell): EngineSummary =>
  ({ engine_code: code, mentioned, cited, share_of_voice: cell(0, 0), series: [] }) as unknown as EngineSummary;

const countsOf = (engines: EngineSummary[]): PromptCounts => ({
  status: 'ready',
  row: { engines } as unknown as PromptSummaryRow,
  entities: [],
  brandedIncluded: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

/** The table of a rate (its card), found by its heading. */
const tableOf = (title: 'Mention rate' | 'Citation rate'): HTMLElement => {
  const section = screen.getByRole('heading', { name: title }).closest('section');
  if (section === null) throw new Error(`The ${title} table is missing`);
  return section;
};

/** The row of a platform in a table. */
const rowOf = (title: 'Mention rate' | 'Citation rate', label: string): HTMLElement =>
  within(tableOf(title)).getByRole('row', { name: new RegExp(label) });

const RANGE = { from: '2026-09-01', to: '2026-09-28' };

function renderStats(engines: ProjectEngine[], rows: EngineSummary[]): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <InspectorStats engines={engines} counts={countsOf(rows)} noCountsReason="No counts" range={RANGE} />,
  );
}

describe('the two rate tables of the Stats tab', () => {
  it('has one table for each rate with a row for each platform, never a pooled row', () => {
    renderStats(
      [engine('chatgpt_web'), engine('gemini_web')],
      [summary('chatgpt_web', cell(3, 6), cell(4, 6)), summary('gemini_web', cell(5, 8), cell(1, 8))],
    );
    for (const title of ['Mention rate', 'Citation rate'] as const) {
      expect(within(tableOf(title)).getByText('95% interval')).toBeInTheDocument();
      expect(
        within(tableOf(title))
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual(['Platform', 'Estimate', 'Interval', 'Sample']);
      expect(within(tableOf(title)).getAllByRole('row')).toHaveLength(3);
    }
    expect(rowOf('Mention rate', 'ChatGPT')).toHaveTextContent('50%');
    expect(rowOf('Mention rate', 'Gemini')).toHaveTextContent('63%');
    expect(rowOf('Citation rate', 'ChatGPT')).toHaveTextContent('67%');
    expect(rowOf('Citation rate', 'Gemini')).toHaveTextContent('13%');
  });

  it('says the sample of each rate with SampleCount', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(5, 8), cell(2, 8))]);
    expect(rowOf('Mention rate', 'ChatGPT').querySelector('[data-slot="sample-count"]')).toHaveTextContent(
      '5 of 8 answers',
    );
    expect(rowOf('Citation rate', 'ChatGPT').querySelector('[data-slot="sample-count"]')).toHaveTextContent(
      '2 of 8 answers',
    );
  });

  it('draws the interval of a rate with enough answers', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(5, 8), cell(2, 8))]);
    expect(
      within(rowOf('Mention rate', 'ChatGPT')).getByRole('img', { name: /^95% interval \d+% to \d+%$/ }),
    ).toBeInTheDocument();
  });

  it('says "No valid answers" and never "0 of 0" or 0% for a rate with no valid answer', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(0, 0), cell(0, 0))]);
    const line = rowOf('Mention rate', 'ChatGPT');
    expect(line).toHaveTextContent('No valid answers');
    expect(line).not.toHaveTextContent('0 of 0');
    expect(line).not.toHaveTextContent('%');
    expect(line.querySelector('[data-slot="sample-count"]')).toHaveTextContent(/^n\/a$/);
  });

  it('shows the count and no rate or interval below the minimum of valid answers', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(1, 2), cell(2, 2))]);
    const line = rowOf('Mention rate', 'ChatGPT');
    expect(line).toHaveTextContent('1 of 2 answers');
    expect(line).toHaveTextContent('Not enough data');
    expect(line).not.toHaveTextContent('%');
    expect(within(line).queryByRole('img')).toBeNull();
  });

  it('says how a rate is made once, under the tables', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(3, 6), cell(4, 6))]);
    expect(screen.getAllByText(/^A rate is successes over valid answers in the period/)).toHaveLength(1);
  });

  it('has no accessibility violation', async () => {
    const { container } = renderStats(
      [engine('chatgpt_web'), engine('gemini_web')],
      [summary('chatgpt_web', cell(3, 6), cell(4, 6)), summary('gemini_web', cell(5, 8), cell(1, 2))],
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the statistics of a rate, opened from the Stats tab', () => {
  const both = (): ReturnType<typeof renderStats> =>
    renderStats(
      [engine('chatgpt_web'), engine('gemini_web')],
      [summary('chatgpt_web', cell(3, 6), cell(4, 6)), summary('gemini_web', cell(5, 8), cell(1, 2))],
    );

  it('opens the statistics of a rate and comes back', async () => {
    const { user, container } = both();
    const open = screen.getByRole('button', { name: 'Open statistics for Mention on Gemini' });
    expect(open).toHaveTextContent('Gemini');
    await user.click(open);
    const panel = container.querySelector<HTMLElement>('[data-slot="statistics-panel"]');
    if (panel === null) throw new Error('The statistics panel is not shown');
    expect(panel).toHaveAttribute('data-placement', 'inspector-tab');
    expect(panel).toHaveTextContent('Mention rate');
    expect(panel).toHaveTextContent('Gemini');
    expect(panel).toHaveTextContent('Sep 1 to Sep 28, 2026');
    expect(panel).toHaveTextContent('5 of 8 answers');
    // One engine per panel: the tables, and the other engine, are not on screen
    expect(screen.queryByRole('heading', { name: 'Mention rate', level: 3 })).toBeNull();
    expect(panel).not.toHaveTextContent('ChatGPT');
    const back = screen.getByRole('button', { name: 'Back to Stats' });
    expect(back).toHaveFocus();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(back);
    expect(container.querySelector('[data-slot="statistics-panel"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open statistics for Mention on Gemini' })).toHaveFocus();
  });

  it('opens the Citation rate of the engine it was pressed on, and no other', async () => {
    const { user, container } = both();
    await user.click(screen.getByRole('button', { name: 'Open statistics for Citation on ChatGPT' }));
    const panel = container.querySelector<HTMLElement>('[data-slot="statistics-panel"]');
    expect(panel).toHaveTextContent('Citation rate');
    expect(panel).toHaveTextContent('ChatGPT');
    expect(panel).toHaveTextContent('4 of 6 answers');
    expect(panel).not.toHaveTextContent('Gemini');
  });

  it('says insufficient in the panel for a rate below the minimum, with no percent', async () => {
    const { user, container } = both();
    await user.click(screen.getByRole('button', { name: 'Open statistics for Citation on Gemini' }));
    const panel = container.querySelector<HTMLElement>('[data-slot="statistics-panel"]');
    expect(panel).toHaveTextContent('Not enough data');
    expect(panel).not.toHaveTextContent('%');
  });

  it('has no button on a line with no valid answer', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(0, 0), cell(3, 6))]);
    expect(screen.queryByRole('button', { name: 'Open statistics for Mention on ChatGPT' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open statistics for Citation on ChatGPT' })).toBeInTheDocument();
  });
});
