import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineCells, promptRow, summaryOf } from '../engines/engines-fixtures';
import HeadlineCard from './headline-card';
import { axe } from '@/test/axe';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const TYPE = 'ai.visibility_split';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';

type Parts = readonly [both: number, named: number, cited: number, neither: number];

/** An engine's cells of one prompt written as the counts of its four outcomes; the other cells follow from them. */
function cells(
  code: 'chatgpt_web' | 'gemini_web',
  [both, named, cited, neither]: Parts,
): ReturnType<typeof engineCells> {
  const n = both + named + cited + neither;
  return engineCells(code, {
    mentioned: [both + named, n],
    cited: [both + cited, n],
    shareOfVoice: [both + named, n],
    outcomes: { mentionedAndCited: [both, n], mentionedOnly: [named, n], citedOnly: [cited, n], neither: [neither, n] },
  });
}

/** Two prompts on the two platforms Fynix has on: ChatGPT 50% visible over 50 answers, Gemini 56% over 16. */
const PROMPTS = [
  promptRow('p1', [cells('chatgpt_web', [10, 5, 5, 20]), cells('gemini_web', [1, 1, 1, 5])]),
  promptRow('p2', [cells('chatgpt_web', [0, 4, 1, 5]), cells('gemini_web', [2, 2, 2, 2])]),
];
const summary = (prompts: typeof PROMPTS): { data: ReturnType<typeof summaryOf> } => ({
  data: summaryOf(prompts, { codes: ['chatgpt_web', 'gemini_web'] }),
});

function serve(prompts: typeof PROMPTS = PROMPTS): void {
  server.use(http.get(SUMMARY, () => HttpResponse.json(summary(prompts))));
}

const renderCard = (search = ''): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(cardInOverview({ type: TYPE, Card: HeadlineCard, width: 'full' }), {
    searchParams: `${WINDOW}${search}`,
  });

const hero = (): Promise<HTMLElement> => screen.findByRole('region', { name: 'AI visibility rate' });
/** The big figure of the hero, once it holds `text`: a percent also stands in the legend, so it is found by its place. */
const heroFigure = async (text: string): Promise<HTMLElement> => {
  const section = await hero();
  await waitFor(() => {
    expect(section.querySelector('.type-metric')).toHaveTextContent(text);
  });
  return section.querySelector<HTMLElement>('.type-metric') ?? section;
};
const tiles = (): Promise<HTMLElement> => screen.findByRole('region', { name: 'Key numbers' });
/** The tile of a label: its box in the strip. */
const tileOf = async (label: string): Promise<HTMLElement> => {
  const box = (await within(await tiles()).findByText(label)).closest<HTMLElement>('div.bg-surface');
  if (box === null) throw new Error(`No tile ${label}`);
  return box;
};

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HeadlineCard', () => {
  it('has the hero and the eight tiles in order, named as the register says', async () => {
    serve();
    renderCard();
    expect(await screen.findByRole('group', { name: 'Headline numbers' })).toHaveAttribute('data-card', TYPE);
    const labels = [...(await tiles()).querySelectorAll('span.type-label')].map((label) => label.textContent);
    expect(labels).toEqual([
      'Mention rate',
      'Share of voice',
      'Citation rate',
      'Mention position',
      'Recommendation rate',
      'Sentiment',
      'Prompts',
      'Runs',
    ]);
    expect(await screen.findByRole('button', { name: 'About AI visibility rate' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'About Mention rate' })).toBeInTheDocument();
  });

  it('All platforms: the hero is the equal-weight average and the tooltip names the platforms, never a pooled ratio', async () => {
    serve();
    renderCard();
    const value = await heroFigure('53%');
    // (50% + 56.25%) / 2; the pooled 41 of 66 answers would be 62%
    expect(value).toHaveAccessibleDescription(
      /^Average of 2 platforms: ChatGPT and Gemini\. 2 prompts, each counted once$/,
    );
    expect(within(await hero()).queryByText('62%')).toBeNull();
    // The four outcomes are named in the legend under the bar
    for (const name of ['Mentioned and cited', 'Mentioned only', 'Cited only', 'Neither']) {
      expect(within(await hero()).getByText(name)).toBeInTheDocument();
    }
  });

  it('one platform: its own figure with the counts, and the four outcomes with their counts', async () => {
    serve();
    renderCard('&engine=chatgpt_web');
    const value = await heroFigure('50%');
    expect(value).toHaveAccessibleDescription('25 of 50 answers. 2 prompts, each counted once');
    const bar = within(await hero()).getByRole('img');
    expect(bar).toHaveAccessibleName(/^Mentioned and cited \d+%, Mentioned only \d+%, Cited only \d+%, Neither \d+%$/);
    const mention = await tileOf('Mention rate');
    expect(within(mention).getByText('39%')).toHaveAccessibleDescription('19 of 50 answers');
  });

  it('position, recommendation and sentiment say they are not collected yet, never a sample and never a zero', async () => {
    serve();
    renderCard();
    for (const label of ['Mention position', 'Recommendation rate', 'Sentiment']) {
      const tile = await tileOf(label);
      expect(within(tile).getByText('n/a')).toBeInTheDocument();
      expect(within(tile).getByText('Not collected yet')).toBeInTheDocument();
      expect(tile).not.toHaveTextContent(/\d%/);
    }
  });

  it('a group shows the project value beside its own, "All groups 53%"', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) => {
        const grouped = new URL(request.url).searchParams.has('filter[term]');
        return HttpResponse.json(summary(grouped ? [PROMPTS[0] ?? promptRow('x', [])] : PROMPTS));
      }),
    );
    renderCard(`&topic=${TOPIC}`);
    // The group holds the first prompt only: ChatGPT 50%, Gemini 37.5%, average 44%
    await heroFigure('44%');
    expect(await within(await hero()).findByText('All groups 53%')).toBeInTheDocument();
    expect(await within(await tileOf('Mention rate')).findByText(/All groups 38%/)).toBeInTheDocument();
  });

  it('with no group no project value is read or drawn', async () => {
    serve();
    renderCard();
    await heroFigure('53%');
    expect(within(await hero()).queryByText(/All groups/)).toBeNull();
  });

  it('a platform that is off says why in the card, and keeps its place', async () => {
    serve();
    renderCard('&engine=google_ai_mode');
    expect(await screen.findByText('Not available for this scope')).toBeInTheDocument();
    expect(screen.getAllByText(/Headline numbers is not measured on Google AI Mode/).length).toBeGreaterThan(0);
  });

  it('a platform under 4 valid answers has no rate, says how many it has, and is not a 0', async () => {
    serve([promptRow('p1', [cells('chatgpt_web', [1, 0, 1, 0])])]);
    renderCard('&engine=chatgpt_web');
    const tile = await tileOf('Mention rate');
    expect(within(tile).getByText('n/a')).toHaveAccessibleDescription('2 answers, too few for a rate');
    expect(within(tile).getByText('Too few answers')).toBeInTheDocument();
    expect(within(await hero()).getByText('Too few answers')).toBeInTheDocument();
    expect(within(await hero()).queryByText('0%')).toBeNull();
  });

  it('the Prompts tile counts the prompts in scope and says what it counts', async () => {
    serve();
    renderCard();
    const tile = await tileOf('Prompts');
    expect(await within(tile).findByText('2')).toHaveAccessibleDescription('core prompts, not branded');
  });

  it('each info button opens what the figure is, then how it is counted', async () => {
    serve();
    const { user } = renderCard();
    await user.click(await screen.findByRole('button', { name: 'About Mention rate' }));
    const dialog = await screen.findByRole('dialog', { name: 'About Mention rate' });
    expect(within(dialog).getByText('How often AI answers mention your brand.')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      /How it’s counted:\s*The share of valid answers whose text contains your brand name/,
    );
  });

  it('shows no change chip: the headline has none', async () => {
    serve();
    renderCard('&cmp=previous');
    await heroFigure('53%');
    expect(screen.queryByText(/ pts$/)).toBeNull();
  });

  it('has no accessibility violation', async () => {
    serve();
    const { container } = renderCard();
    await heroFigure('53%');
    await waitFor(async () => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
