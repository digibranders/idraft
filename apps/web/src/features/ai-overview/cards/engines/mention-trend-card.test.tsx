import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MentionTrendCard from './mention-trend-card';
import type { CardProps } from '@/features/layouts';
import type { ChartTokens } from '@/lib/design/read-tokens';
import type { Role } from '@/lib/api/types';
import { axe } from '@/test/axe';
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

vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option, height }: { option: (tokens: ChartTokens) => Record<string, unknown>; height: number }) => {
    option(TOKENS);
    return <div data-testid="echart-canvas" data-height={height} />;
  },
}));

const WINDOW = 'from=2026-10-16&to=2026-11-12';
const TYPE = 'ai.mention_trend';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The card with the option of an engine, as the layout would give it. */
function withEngine(engine: string): (props: CardProps) => ReactElement {
  return function Engine(props: CardProps): ReactElement {
    return <MentionTrendCard {...props} options={{ engine }} />;
  };
}

const render = (engine: string, search: string = WINDOW, role: Role = 'admin') =>
  renderWithProviders(cardInOverview({ type: TYPE, Card: withEngine(engine), role }), { searchParams: search });

describe('the mention trend card', () => {
  it('draws the engine of the option as one panel, ChatGPT by default', async () => {
    render('chatgpt_web');
    expect(await screen.findByRole('heading', { name: 'Mention rate trend' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Gemini' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('echart-canvas')).toHaveLength(1);
    // No Series menu: the card is about one metric
    expect(screen.queryByRole('combobox', { name: 'Series' })).not.toBeInTheDocument();
  });

  it('draws Gemini when the option is Gemini', async () => {
    render('gemini_web');
    expect(await screen.findByRole('img', { name: 'Gemini' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'ChatGPT' })).not.toBeInTheDocument();
  });

  it('keeps one panel at 180 px while it loads and when it has loaded', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY, async () => {
        await gate;
        return undefined;
      }),
    );
    render('chatgpt_web');
    const title = await screen.findByRole('heading', { name: 'Mention rate trend' });
    expect(title.closest('section')?.querySelector('div[style*="height: 180px"]')).not.toBeNull();
    release();
    expect(await screen.findByRole('img', { name: 'ChatGPT' })).toBeInTheDocument();
  });

  it('says an engine that is off in the project is off, and offers Settings to a member who may turn it on', async () => {
    render('google_ai_mode');
    expect(await screen.findByText('AI Mode is off for this project')).toBeInTheDocument();
    expect(screen.getByText('Turn it on to see its trend.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Turn on engines' });
    expect(link.getAttribute('href')).toBe('/digibranders/fynix/settings/engines');
    expect(screen.queryByRole('img', { name: 'AI Mode' })).not.toBeInTheDocument();
  });

  it('sends a member who may not turn engines on to a workspace admin, with no link', async () => {
    render('google_ai_mode', WINDOW, 'viewer');
    expect(await screen.findByText('AI Mode is off for this project')).toBeInTheDocument();
    expect(screen.getByText('Ask a workspace admin to turn on an engine')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Turn on engines' })).not.toBeInTheDocument();
  });

  it('says an engine outside the page filter is not in it', async () => {
    render('chatgpt_web', `${WINDOW}&engine=gemini_web`);
    expect(await screen.findByText('ChatGPT is not in the engine filter')).toBeInTheDocument();
    expect(screen.getByText('Add it to the engines of this page to see its trend.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'ChatGPT' })).not.toBeInTheDocument();
  });

  it('axe finds no violation, drawn and empty', async () => {
    const drawn = render('chatgpt_web');
    await screen.findByRole('img', { name: 'ChatGPT' });
    expect(await axe(drawn.container)).toHaveNoViolations();
    drawn.unmount();
    const off = render('google_ai_mode');
    const empty = await screen.findByText('AI Mode is off for this project');
    expect(within(off.container).getByText('Turn it on to see its trend.')).toBeInTheDocument();
    expect(empty).toBeInTheDocument();
    expect(await axe(off.container)).toHaveNoViolations();
  });
});
