import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InspectorStats } from './inspector-stats';
import type { PromptCounts } from './inspector-reads';
import type { EngineSummary, MetricCell, ProjectEngine, PromptSummaryRow } from '@/lib/api/types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
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

function renderStats(engines: ProjectEngine[], rows: EngineSummary[]): void {
  renderWithProviders(<InspectorStats engines={engines} counts={countsOf(rows)} noCountsReason="No counts" />);
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
