import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnginePanel } from './engine-panel';
import { cell, engine, topicRow, weighted, type EngineCells } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineSummary } from '@/lib/api/types';
import { DRAWER_TOPIC_ID, READY_COUNTS, renderDrawerPart, summaryOf } from '@/test/topic-drawer-harness';

/** The address the page is on, which the panel builds its links from (the mock of the router has no history). */
const address = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(address.search),
}));

const WEIGHTED_NOTE = 'Each prompt counts once, whatever the number of its answers.';

/** Share of voice is one answer one weight: `n` answers that name a brand, `k` of their shares summed. */
const share = (k: number, n: number) => cell(k, n, n);

const chatgpt = (over: EngineCells = {}): EngineSummary =>
  engine('chatgpt_web', {
    mentioned: weighted(3, 8, 4),
    cited: weighted(2, 8, 4),
    share_of_voice: share(2, 5),
    ...over,
  });
const gemini = (over: EngineCells = {}): EngineSummary =>
  engine('gemini_web', {
    mentioned: weighted(2, 8, 4),
    cited: weighted(4, 8, 4),
    share_of_voice: share(1, 4),
    ...over,
  });

const summaryWith = (engines: readonly EngineSummary[], last: string | null = null) =>
  summaryOf([{ ...topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4, engines), last_valid_at: last }]);

/** The engine rows, whatever the metric the list is named by. */
const rows = (): HTMLElement[] => within(screen.getByRole('list', { name: / by engine$/ })).getAllByRole('listitem');
const labelsOf = (): (string | null)[] =>
  rows().map((row) => row.querySelector('[data-slot="bar-list-label"]')?.textContent ?? null);

const render = (
  engines: readonly EngineSummary[] = [chatgpt(), gemini()],
  search = '',
  options: Parameters<typeof renderDrawerPart>[1] = {},
) => {
  address.search = search;
  return renderDrawerPart(<EnginePanel />, { summary: summaryWith(engines), searchParams: search, ...options });
};

describe('EnginePanel: the By engine section of the drawer', () => {
  it('lists every engine shown in order with percent and k of n', () => {
    render();
    expect(labelsOf()).toEqual(['ChatGPT', 'Gemini']);
    const [first, second] = rows();
    expect(first).toHaveTextContent('38%');
    expect(first).toHaveTextContent('3 of 8 answers, 4 prompts');
    expect(second).toHaveTextContent('25%');
    expect(second).toHaveTextContent('2 of 8 answers, 4 prompts');
    expect(screen.getByRole('heading', { name: 'By engine' })).toBeInTheDocument();
  });

  it('shows the weighted note', () => {
    render();
    expect(screen.getByText(WEIGHTED_NOTE)).toBeInTheDocument();
  });

  it('share of voice says answers naming a brand and never a count of successes', () => {
    render([chatgpt(), gemini()], '?metric=sov');
    const [first, second] = rows();
    expect(first).toHaveTextContent('40%');
    expect(first).toHaveTextContent('5 answers naming a brand, 4 prompts');
    expect(second).toHaveTextContent('25%');
    expect(second).toHaveTextContent('4 answers naming a brand, 4 prompts');
    expect(first?.textContent).not.toMatch(/\d+ of \d+/);
  });

  it('the metric control switches Mention, Citation and Share of voice and writes ?metric', async () => {
    const writes: string[] = [];
    const { user } = render([chatgpt(), gemini()], '', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    expect(screen.getByRole('combobox', { name: 'Metric of the engine panel' })).toHaveTextContent('Mention');
    await user.click(screen.getByRole('combobox', { name: 'Metric of the engine panel' }));
    await user.click(await screen.findByRole('option', { name: 'Citation' }));
    expect(new URLSearchParams(writes.at(-1)).get('metric')).toBe('citation');
    // The rows follow the address: Gemini's 4 of 8 citations
    expect(await screen.findByRole('list', { name: 'Citation by engine' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Metric of the engine panel' }));
    await user.click(await screen.findByRole('option', { name: 'Share of voice' }));
    expect(new URLSearchParams(writes.at(-1)).get('metric')).toBe('sov');
  });

  it('an engine row leads to the Prompts tab filtered to that engine', () => {
    render([chatgpt(), gemini()], '?view=engines&metric=citation');
    const link = screen.getByRole('link', { name: 'Gemini: 50%, 4 of 8 answers' });
    const [path, query] = (link.getAttribute('href') ?? '').split('?');
    expect(path).toBe('/digibranders/fynix/ai/prompts');
    const params = new URLSearchParams(query);
    expect(params.get('inspect')).toBe(`topic:${DRAWER_TOPIC_ID}`);
    expect(params.get('itab')).toBe('prompts');
    expect(params.get('eng')).toBe('gemini_web');
    // Every other key of the address stays
    expect(params.get('view')).toBe('engines');
    expect(params.get('metric')).toBe('citation');
  });

  it('shows the change in points only when cells carry previous, coloured only when detectable', () => {
    render([
      chatgpt({ mentioned: weighted(40, 80, 4), previous: { mentioned: weighted(20, 80, 4) } }),
      gemini({ mentioned: weighted(5, 10, 4), previous: { mentioned: weighted(4, 10, 4) } }),
    ]);
    const [first, second] = rows();
    const colour = (row: HTMLElement | undefined, text: string): string =>
      (within(row ?? document.body).getAllByText(text, { selector: '[aria-hidden="true"]' })[0] ?? document.body)
        .className;
    expect(first).toHaveTextContent('+25.0 pts');
    expect(colour(first, '+25.0 pts')).toContain('text-positive-text');
    // Within normal variation: a change that is not told from noise is never coloured
    expect(colour(second, '+10.0 pts')).toContain('text-foreground-secondary');
    expect(colour(second, '+10.0 pts')).not.toContain('text-positive-text');
  });

  it('shows no change without previous', () => {
    render();
    // The sentence under the rows names the gap in points; no row names a change
    for (const row of rows()) expect(row.textContent).not.toMatch(/\d pts/);
  });

  it('an engine with no data says no answers, is never 0 and is no link', () => {
    render([chatgpt()]);
    expect(labelsOf()).toEqual(['ChatGPT', 'Gemini']);
    const [, second] = rows();
    expect(second).toHaveTextContent('No answers');
    expect(second?.textContent).not.toMatch(/0%/);
    expect(screen.queryByRole('link', { name: /Gemini/ })).toBeNull();
  });

  it('marks an engine with too few answers by its answers and draws no bar for it', () => {
    const { container } = render([chatgpt(), gemini({ mentioned: weighted(1, 3, 2) })]);
    const [, second] = rows();
    expect(second).toHaveTextContent('3 answers');
    expect(second?.textContent).not.toMatch(/%/);
    expect(container.querySelectorAll('[data-slot="bar-list-bar"]')).toHaveLength(1);
  });

  it('writes the compared engines in the comparison sentence under the rows', () => {
    render();
    expect(
      screen.getByText(/^Best on ChatGPT at 37.5%, weakest on Gemini at 25.0%, a gap of 12.5 pts\./),
    ).toBeVisible();
  });

  it('loading is a skeleton, a failed read has Retry, an unknown topic says so', async () => {
    const retry = vi.fn();
    const loading = renderDrawerPart(<EnginePanel />, { counts: { ...READY_COUNTS, status: 'loading' } });
    expect(screen.getByRole('heading', { name: 'By engine' }).closest('section')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('list', { name: 'Mention by engine' })).toBeNull();
    loading.unmount();

    const failed = renderDrawerPart(<EnginePanel />, { counts: { ...READY_COUNTS, status: 'failed', retry } });
    await failed.user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    failed.unmount();

    renderDrawerPart(<EnginePanel />, { summary: summaryOf([]) });
    expect(screen.getByText('The topic could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Mention by engine' })).toBeNull();
  });

  it('keeps the rows while a new window is read', () => {
    // The page keeps the previous summary while the next is read: the counts say loading, the rows stay
    render([chatgpt(), gemini()], '', { counts: { ...READY_COUNTS, status: 'loading' } });
    expect(labelsOf()).toEqual(['ChatGPT', 'Gemini']);
    expect(screen.getByRole('heading', { name: 'By engine' }).closest('section')).not.toHaveAttribute('aria-busy');
  });

  it('says when the topic has had no valid answer for a week', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    try {
      address.search = '';
      renderDrawerPart(<EnginePanel />, { summary: summaryWith([chatgpt(), gemini()], '2026-10-30T02:00:00Z') });
      expect(screen.getByText('No valid answer since Oct 30.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing of staleness for a topic answered in the last week', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    try {
      address.search = '';
      renderDrawerPart(<EnginePanel />, { summary: summaryWith([chatgpt(), gemini()], '2026-11-10T02:00:00Z') });
      expect(screen.queryByText(/No valid answer since/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
