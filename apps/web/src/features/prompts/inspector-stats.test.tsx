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

/** The section of an engine, found by its heading. */
const sectionOf = (label: string): HTMLElement => {
  const section = screen.getByRole('heading', { name: label }).closest('section');
  if (section === null) throw new Error(`The ${label} section is missing`);
  return section;
};

const RANGE = { from: '2026-09-01', to: '2026-09-28' };

function renderStats(engines: ProjectEngine[], rows: EngineSummary[]): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <InspectorStats engines={engines} counts={countsOf(rows)} noCountsReason="No counts" range={RANGE} />,
  );
}

describe('the sample of each rate in the Stats tab', () => {
  it('says the sample with SampleCount', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(5, 8), cell(2, 8))]);
    const [mention, citation] = within(sectionOf('ChatGPT')).getAllByRole('listitem');
    const sample = (mention as HTMLElement).querySelector('[data-slot="sample-count"]');
    expect(sample).toHaveTextContent('5 of 8 answers');
    expect((citation as HTMLElement).querySelector('[data-slot="sample-count"]')).toHaveTextContent('2 of 8 answers');
  });

  it('shows n/a and never "0 of 0" for a rate with no valid answer', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(0, 0), cell(0, 0))]);
    const section = sectionOf('ChatGPT');
    const samples = section.querySelectorAll('[data-slot="sample-count"]');
    expect(samples).toHaveLength(2);
    samples.forEach((sample) => {
      expect(sample).toHaveTextContent(/^n\/a$/);
    });
    expect(section).not.toHaveTextContent('0 of 0');
  });

  it('shows the sample and no rate below the minimum of valid answers', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(1, 2), cell(2, 2))]);
    const [mention] = within(sectionOf('ChatGPT')).getAllByRole('listitem');
    expect(mention).toHaveTextContent('1 of 2 answers');
    expect(mention).toHaveTextContent('Too few answers for a reliable rate');
  });
});

describe('the aggregation of each engine in the Stats tab', () => {
  it('names it once in every engine section, so no reader takes a rate for a pooled one', () => {
    renderStats(
      [engine('chatgpt_web'), engine('gemini_web')],
      [summary('chatgpt_web', cell(3, 6), cell(4, 6)), summary('gemini_web', cell(5, 8), cell(1, 8))],
    );
    for (const label of ['ChatGPT', 'Gemini']) {
      const section = sectionOf(label);
      const line = `${label} only: rates count valid answers, each of this prompt counted once`;
      expect(within(section).getAllByText(line)).toHaveLength(1);
    }
    expect(screen.getAllByText(/rates count valid answers, each of this prompt counted once/)).toHaveLength(2);
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
    expect(open).toHaveTextContent('Open statistics');
    await user.click(open);
    const panel = container.querySelector<HTMLElement>('[data-slot="statistics-panel"]');
    if (panel === null) throw new Error('The statistics panel is not shown');
    expect(panel).toHaveAttribute('data-placement', 'inspector-tab');
    expect(panel).toHaveTextContent('Mention rate');
    expect(panel).toHaveTextContent('Gemini');
    expect(panel).toHaveTextContent('Sep 1 to Sep 28, 2026');
    expect(panel).toHaveTextContent('5 of 8 answers');
    // One engine per panel: the list, and the other engine, are not on screen
    expect(screen.queryByRole('list', { name: /Rates of/ })).toBeNull();
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
    expect(panel).toHaveTextContent('Insufficient data');
    expect(panel).not.toHaveTextContent('%');
  });

  it('has no button on a line with no valid answer', () => {
    renderStats([engine('chatgpt_web')], [summary('chatgpt_web', cell(0, 0), cell(3, 6))]);
    expect(screen.queryByRole('button', { name: 'Open statistics for Mention on ChatGPT' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open statistics for Citation on ChatGPT' })).toBeInTheDocument();
  });
});
