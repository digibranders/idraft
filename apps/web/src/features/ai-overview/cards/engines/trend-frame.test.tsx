import { act, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RateTrendCard from './rate-trend-card';
import type { CardProps } from '@/features/layouts';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const TOKENS: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Inter',
  other: '#other',
  reference: '#reference',
  grid: '#grid',
  band: '#band',
  rankBandNone: '#none',
  surfaceElevated: '#elevated',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
};

// The option each canvas was last given, by the id of its first series: jsdom has no canvas
const built = vi.hoisted(() => ({ options: new Map<string, Record<string, unknown>>() }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option, height }: { option: (tokens: ChartTokens) => Record<string, unknown>; height: number }) => {
    const drawn = option(TOKENS);
    const first = (drawn.series as { id: string }[])[0];
    if (first !== undefined) built.options.set(first.id, drawn);
    return <div data-testid="echart-canvas" data-height={height} />;
  },
}));

const WINDOW = 'from=2026-10-16&to=2026-11-12';
const TYPE = 'ai.rate_trend_by_engine';

beforeEach(() => {
  built.options.clear();
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (search: string = WINDOW): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(cardInOverview({ type: TYPE, Card: RateTrendCard, width: 'two_thirds' }), {
    searchParams: search,
  });

const seriesIds = (id: string): string[] =>
  ((built.options.get(id)?.series ?? []) as { id: string }[]).map((series) => series.id);

describe('the trend frame, through the rate trend card', () => {
  it('draws one panel per asked engine in catalog order', async () => {
    render();
    const panels = await screen.findAllByRole('img', { name: /^(ChatGPT|Gemini|AI Mode)$/ });
    expect(panels.map((panel) => panel.getAttribute('aria-label'))).toEqual(['ChatGPT', 'Gemini']);
    expect(screen.queryByRole('img', { name: 'AI Mode' })).not.toBeInTheDocument();
  });

  it('the Series menu switches the metric of every panel and changes nothing saved', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(cardInOverview({ type: TYPE, Card: RateTrendCard, width: 'two_thirds' }), {
      searchParams: WINDOW,
      onUrlUpdate,
    });
    await screen.findByRole('heading', { name: 'Mention rate by engine' });
    await waitFor(() => {
      expect(built.options.has('chatgpt_web')).toBe(true);
    });
    const mention = JSON.stringify((built.options.get('chatgpt_web')?.series as { data: unknown[] }[])[0]?.data);
    await user.click(screen.getByRole('combobox', { name: 'Series' }));
    await user.click(await screen.findByRole('option', { name: 'Citation rate' }));
    expect(await screen.findByRole('heading', { name: 'Citation rate by engine' })).toBeInTheDocument();
    await waitFor(() => {
      expect(JSON.stringify((built.options.get('chatgpt_web')?.series as { data: unknown[] }[])[0]?.data)).not.toBe(
        mention,
      );
    });
    // Both panels follow the one menu
    expect(built.options.has('gemini_web')).toBe(true);
    // The choice is the viewer's: the address and the saved option stay as they were
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it('the legend toggles a panel and the last one cannot be hidden', async () => {
    const { user } = render();
    const legend = await screen.findByRole('list', { name: 'Series in Mention rate by engine' });
    // Every entry, in order, through the real controls
    const entries = within(legend).getAllByRole('button');
    for (const entry of entries) await user.click(entry);
    // A refused last toggle must not bring the first panel back: with the guard gone every panel is hidden, and the
    // part then shows them all again, which looks like "one stayed" only by accident
    expect(screen.queryByRole('img', { name: 'ChatGPT' })).not.toBeInTheDocument();
    expect(within(legend).getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('img', { name: /^(ChatGPT|Gemini)$/ })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Gemini' })).toBeInTheDocument();
    expect(within(legend).getByRole('button', { name: 'Gemini' })).toHaveAttribute('aria-pressed', 'true');
    // The refusal is announced after the legend's own message
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent(
        'Gemini stays shown: at least one chart must be visible',
      );
    });
  });

  it('draws the previous window dashed only when the comparison is on and paired', async () => {
    const on = render();
    await screen.findAllByRole('img', { name: 'ChatGPT' });
    await waitFor(() => {
      expect(seriesIds('chatgpt_web')).toContain('chatgpt_web:previous');
    });
    on.unmount();
    built.options.clear();
    render(`${WINDOW}&cmp=off`);
    await screen.findAllByRole('img', { name: 'ChatGPT' });
    await waitFor(() => {
      expect(built.options.has('chatgpt_web')).toBe(true);
    });
    expect(seriesIds('chatgpt_web')).not.toContain('chatgpt_web:previous');
  });

  it('reads the schedule while the card is live and asks for neither it nor the summary while it is not', async () => {
    const seen: string[] = [];
    const record = (): void => {
      server.use(
        http.get('*/api/v1/workspaces/:w/projects/:p/schedules', ({ request }) => {
          seen.push(new URL(request.url).pathname);
          return undefined;
        }),
        http.get('*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary', ({ request }) => {
          seen.push(new URL(request.url).pathname);
          return undefined;
        }),
      );
    };
    record();
    const live = render();
    await screen.findAllByRole('img', { name: 'ChatGPT' });
    await waitFor(() => {
      expect(seen.some((path) => path.endsWith('/schedules'))).toBe(true);
    });
    live.unmount();

    seen.length = 0;
    function Paused(props: CardProps): ReactElement {
      return <RateTrendCard {...props} live={false} />;
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: Paused, width: 'two_thirds' }), { searchParams: WINDOW });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(seen).toEqual([]);
  });

  it('refetching keeps the panels and shows the refetch bar', async () => {
    const { queryClient } = render();
    await screen.findAllByRole('img', { name: 'ChatGPT' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary', async () => {
        await gate;
        return undefined;
      }),
    );
    void queryClient.invalidateQueries();
    await waitFor(() => {
      expect(document.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    // The panels never leave while the figures behind them are read again
    expect(screen.getByRole('img', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Gemini' })).toBeInTheDocument();
    release();
    await waitFor(() => {
      expect(document.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
  });
});
