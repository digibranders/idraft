import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MeasuresStrip } from './measures-strip';
import type { CitationOverview } from '@/lib/citations/board-queries';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const OVERVIEW: CitationOverview = {
  citations: 60,
  previous_citations: 50,
  matched_citations: 58,
  matched_previous_citations: 49,
  matched_pairs: 60,
  own_urls: 8,
  previous_own_urls: 6,
  domains: 20,
  previous_domains: 20,
  engines: [
    {
      engine_code: 'chatgpt_web',
      answers: 100,
      answers_citing: 25,
      prompts: 40,
      prompts_citing: 20,
      previous_answers: 100,
      previous_answers_citing: 20,
      previous_prompts: 40,
      previous_prompts_citing: 16,
    },
  ],
  window: {
    runs: 4,
    timezone: 'Europe/Berlin',
    current: [],
    previous: [],
    trend: [],
    answers: 100,
    prompts: 40,
    latest_answer_at: null,
    latest_run_number: null,
  },
};

describe('the Citations strip', () => {
  it('draws the six measures with their deltas, and is accessible', async () => {
    const { container } = renderWithProviders(
      <MeasuresStrip
        overview={OVERVIEW}
        status="ready"
        allPlatforms={false}
        ownDomain="fynix.digital"
        previous={{ full: 'the previous 4 runs (Aug 10 to Aug 31)', short: 'the previous 4 runs' }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Citation measures' })).toBeVisible();
    expect(screen.getByLabelText(/^Total citations: 60\. /)).toBeVisible();
    expect(screen.getByText('Up 5.0 pts, within normal variation')).toHaveClass('sr-only');
    expect(screen.getByText('+2')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps the labels and draws skeletons while loading', () => {
    renderWithProviders(
      <MeasuresStrip
        overview={undefined}
        status="loading"
        allPlatforms
        ownDomain="fynix.digital"
        previous={{ full: '', short: '' }}
      />,
    );
    expect(screen.getByText('Total citations')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Citation measures' })).toHaveAttribute('aria-busy', 'true');
  });
});
