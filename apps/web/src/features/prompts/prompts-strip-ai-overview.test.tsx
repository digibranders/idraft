import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ComparedWindowProvider } from './compare/compared-window';
import { projectEngine } from './compare/change-test-data';
import { PromptsStrip } from './prompts-strip';
import type { AiOverviewTotals } from '@/lib/rates/ai-overview';
import { renderWithProviders } from '@/test/render';

const totals = (over: Partial<AiOverviewTotals>): AiOverviewTotals => ({
  prompts: 30,
  linked: 20,
  tracked: 12,
  shown: 8,
  cited_own: 2,
  keywords_shown: 6,
  keywords_cited: 2,
  observed_at: '2026-11-20T08:00:00Z',
  ...over,
});

function chipOf(): HTMLElement {
  const term = within(screen.getByRole('group', { name: 'Summary of the prompts in view' }))
    .getAllByRole('term')
    .find((entry) => entry.textContent === 'Google AI Overview');
  const chip = term?.parentElement;
  if (chip === null || chip === undefined) throw new Error('The Google AI Overview chip is missing');
  return within(chip).getByRole('definition');
}

const render = (aiOverview: AiOverviewTotals | undefined, overviewIsOn = false): void => {
  renderWithProviders(
    <ComparedWindowProvider value={{ from: '2026-09-18', to: '2026-10-15' }}>
      <PromptsStrip
        prompts={[]}
        engines={[projectEngine('chatgpt_web'), ...(overviewIsOn ? [projectEngine('google_ai_overview')] : [])]}
        topics={1}
        status="ready"
        countsFailed={false}
        aiOverview={aiOverview}
      />
    </ComparedWindowProvider>,
  );
};

describe('the Google AI Overview chip of the strip', () => {
  it('shows the cited share of the prompts whose keyword shows one, with its counts', async () => {
    render(totals({}));
    const chip = chipOf();
    expect(chip).toHaveTextContent('25%');
    await userEvent.setup().hover(chip);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
        '2 of 8 prompts whose keyword shows a Google AI Overview have one that cites your site, over 6 keywords',
      ),
    );
  });

  it('keeps the keyword figure, not an answer rate, once Google AI Overview is a platform of the project', async () => {
    render(totals({}), true);
    const chip = chipOf();
    expect(chip).toHaveTextContent('25%');
    await userEvent.setup().hover(chip);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
        '2 of 8 prompts whose keyword shows a Google AI Overview',
      ),
    );
  });

  it('shows the count, not a rate, under 4 keywords', () => {
    render(totals({ shown: 9, keywords_shown: 3 }));
    expect(chipOf()).toHaveTextContent('9');
    expect(chipOf()).not.toHaveTextContent('%');
  });

  it('says n/a, never 0%, when no overview was shown or nothing is tracked', () => {
    render(totals({ shown: 0, cited_own: 0, keywords_shown: 0 }));
    expect(chipOf()).toHaveTextContent('n/a');
  });

  it('keeps the not collected state while the read carries no figure', () => {
    render(undefined);
    expect(chipOf()).toHaveTextContent('n/a');
  });
});
