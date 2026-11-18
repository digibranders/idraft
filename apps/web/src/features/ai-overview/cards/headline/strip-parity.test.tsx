import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOverviewEngines, useOverviewSummary } from '../../overview-context';
import HeadlineCard from './headline-card';
import { PromptsStrip } from '@/features/prompts/prompts-strip';
import type { CardProps } from '@/features/layouts';
import { setAiSeeded } from '@/mocks/ai-seed';
import { cardInOverview, type OverviewWorld } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

/**
 * R12: the Overview headline and the Prompts strip are one number for the same scope. The strip shows AI visibility
 * per platform over the prompts it is given; the headline's hero shows it for the Platform in the scope. Both are
 * read from the DOM, so the test compares what a person sees, from two code paths, and not a value it computed itself.
 */

/** The real card and, beside it, the real strip over the prompts of the very same summary read. */
function CardWithStrip(props: CardProps): ReactElement {
  const engines = useOverviewEngines();
  const summary = useOverviewSummary();
  const enabled = (engines.data ?? []).filter((engine) => engine.is_enabled);
  return (
    <>
      <HeadlineCard {...props} />
      {summary.data === undefined ? null : (
        <PromptsStrip
          prompts={summary.data.prompts}
          engines={enabled}
          topics={null}
          status="ready"
          countsFailed={false}
        />
      )}
    </>
  );
}

const STRIP_LABELS: Readonly<Record<string, string>> = {
  chatgpt_web: 'ChatGPT',
  gemini_web: 'Gemini',
  google_ai_mode: 'Google AI Mode',
};

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAiSeeded(false);
});

describe('the headline and the Prompts strip (R12)', () => {
  it.each<{ world: OverviewWorld; seeded: boolean; code: string }>([
    { world: 'fynix', seeded: false, code: 'chatgpt_web' },
    { world: 'fynix', seeded: false, code: 'gemini_web' },
    { world: 'eventus-security', seeded: true, code: 'chatgpt_web' },
    { world: 'eventus-security', seeded: true, code: 'gemini_web' },
  ])('show one AI visibility figure for $code of $world', async ({ world, seeded, code }) => {
    setAiSeeded(seeded);
    renderWithProviders(cardInOverview({ type: 'ai.visibility_split', Card: CardWithStrip, width: 'full', world }), {
      searchParams: `from=2026-10-16&to=2026-11-12&engine=${code}`,
    });
    const chips = await screen.findByRole('group', { name: 'Summary of the prompts in view' });
    await waitFor(() => {
      expect(chips).not.toHaveAttribute('aria-busy');
    });
    const slot = within(chips)
      .getAllByRole('term')
      .find((term) => term.textContent === STRIP_LABELS[code])
      ?.parentElement?.querySelector('dd');
    if (slot === null || slot === undefined) throw new Error(`The strip has no slot for ${code}`);
    const heroSection = await screen.findByRole('region', { name: 'AI visibility rate' });
    const figure = heroSection.querySelector<HTMLElement>('.type-metric');
    // The strip's percent is the hero's; a figure the strip cannot give is "n/a" or a count of answers, and the hero says "n/a"
    await waitFor(() => {
      expect(figure?.textContent).not.toBe('');
    });
    const shown = slot.textContent ?? '';
    if (/%$/.test(shown)) expect(figure).toHaveTextContent(shown);
    else expect(figure).toHaveTextContent('n/a');
    // The fixtures hold a rate for the platform, so the comparison above is a comparison of percents
    expect(shown).toMatch(/%$/);
  });
});
