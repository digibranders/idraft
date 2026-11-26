import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReferralsCard from './referrals-card';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { Schemas } from '@/lib/api/types';
import { problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Answer = Schemas['AiReferralsResponse'];
type Value = Schemas['AiReferralValue'];

const ROUTE = '*/api/v1/workspaces/:w/projects/:p/fp/ai-referrals';
const NOTES = [
  'Google AI Mode and Google AI Overview are not counted: Google Analytics files their sessions under organic search.',
  'The figures are a lower bound: visits without a referrer, such as clicks from native apps, are filed under direct.',
  'The two classifiers are shown side by side and neither is labelled correct.',
];

function render(searchParams: string): ReturnType<typeof renderWithProviders> {
  const Card = (): ReactElement => (
    <CardInfoProvider>
      <ReferralsCard />
    </CardInfoProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'traffic.ai_referrals', Card, width: 'two_thirds' }), {
    searchParams,
  });
}

/** The project has a live GA4 property, as the integrations list says. */
function linkGa4(): void {
  server.use(
    http.get('*/api/v1/workspaces/:w/projects/:p/integrations', () =>
      HttpResponse.json({
        data: [{ integration_id: 'i1', kind: 'ga4', status: 'active' }],
        page: { limit: 50, offset: 0, total: 1 },
      }),
    ),
  );
}

const value = (sessions: number, previous: number | null, engaged = Math.round(sessions * 0.7)): Value => ({
  sessions,
  engaged_sessions: engaged,
  key_events: null,
  previous:
    previous === null ? null : { sessions: previous, engaged_sessions: Math.round(previous * 0.7), key_events: null },
});

function row(key: string, own: Value | null, ga4: Value | null): Answer['data'][number] {
  return {
    key,
    own_rules: own,
    ga4_ai_assistant_channel: ga4,
    difference: own?.sessions == null || ga4?.sessions == null ? null : own.sessions - ga4.sessions,
  };
}

function answer(data: Answer['data'], meta: Partial<Answer['meta']> = {}): Answer {
  return {
    data,
    meta: {
      connected: true,
      collected_through: '2026-11-11',
      collected_since: '2026-08-28',
      last_success_at: '2026-11-12T06:00:00Z',
      window: { from: '2026-10-15', to: '2026-11-11', timezone: 'Europe/Berlin' },
      compare_window: { from: '2026-09-17', to: '2026-10-14', timezone: 'Europe/Berlin' },
      window_collected: true,
      rules_version: 1,
      lower_bound: true,
      notes: NOTES,
      ...meta,
    },
  };
}

/** The own rules order is Gemini, ChatGPT, Claude, Copilot; the GA4 channel order is Claude first. */
const DATA = [
  row('gemini', value(300, 200), value(50, 40)),
  row('chatgpt', value(120, 100), value(110, 90)),
  row('claude', value(40, 50), value(160, 150)),
  row('copilot', value(8, null), value(6, null)),
];

function serve(response: Answer): void {
  server.use(http.get(ROUTE, () => HttpResponse.json(response)));
}

const listOf = async (): Promise<HTMLElement> => screen.findByRole('list', { name: 'AI referral visits by platform' });
const namesIn = (list: HTMLElement): string[] =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent ?? '');

describe('the AI referral visits card', () => {
  it('says GA4 is not connected, with the way to connect it, and draws no visit', async () => {
    render('cmp=off');
    expect(await screen.findByRole('heading', { name: 'AI referral visits' })).toBeInTheDocument();
    expect(await screen.findByText('GA4 is not connected')).toBeInTheDocument();
    const connect = screen.getByRole('link', { name: 'Connect GA4' });
    expect(connect.getAttribute('href')).toContain('/integrations');
    expect(screen.queryByText(/Sample/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'AI referral visits by platform' })).not.toBeInTheDocument();
  });

  it('says GA4 is connected, and offers no connect button, when it is linked and nothing is collected', async () => {
    linkGa4();
    serve(
      answer([], { collected_through: null, collected_since: null, window_collected: false, compare_window: null }),
    );
    render('cmp=off');
    expect(await screen.findByText('GA4 is connected, visits are not collected yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect GA4' })).not.toBeInTheDocument();
    expect(screen.queryByText('GA4 is not connected')).not.toBeInTheDocument();
  });

  it('asks for the period, both ways of counting and the platform grouping, with the comparison the scope has', async () => {
    linkGa4();
    const asked: URL[] = [];
    server.use(
      http.get(ROUTE, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json(answer(DATA));
      }),
    );
    render('');
    await listOf();
    const query = asked[0]?.searchParams;
    expect(query?.get('classifier')).toBe('both');
    expect(query?.get('group_by')).toBe('assistant');
    expect(query?.get('compare')).toBe('previous_period');
    expect(query?.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query?.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('draws one bar per platform, largest first, with its visits and its change against the compared period', async () => {
    linkGa4();
    serve(answer(DATA));
    render('cmp=off');
    const list = await listOf();
    expect(namesIn(list)).toEqual(['Gemini', 'ChatGPT', 'Claude', 'Copilot']);
    const [gemini, chatgpt, claude] = within(list).getAllByRole('listitem');
    expect(gemini?.textContent).toContain('300');
    expect(gemini?.textContent).toContain('+100');
    expect(chatgpt?.textContent).toContain('120');
    expect(chatgpt?.textContent).toContain('+20');
    expect(claude?.textContent).toContain('−10');
    // Flat bars in the neutral token: no glow, no shadow, no rainbow
    const bars = list.querySelectorAll('[data-slot="bar-list-bar"]');
    expect(bars).toHaveLength(4);
    for (const bar of bars) {
      expect(bar.className).toContain('bg-chart-bar-neutral');
      expect(bar.className).not.toMatch(/shadow|glow|gradient/);
    }
  });

  it('writes no change for a platform whose previous is null, never a 0', async () => {
    linkGa4();
    serve(answer(DATA));
    render('cmp=off');
    const list = await listOf();
    const copilot = within(list).getAllByRole('listitem')[3];
    expect(copilot?.textContent).toContain('Copilot');
    expect(copilot?.textContent).toContain('8');
    expect(copilot?.textContent).not.toMatch(/[+−]\d|against the compared period/);
    expect(copilot?.querySelector('[data-slot="bar-list-trailing"]')?.textContent ?? '').toBe('');
  });

  it('counts by our rules at first, and by the GA4 channel when it is chosen, keeping both in the Table view', async () => {
    linkGa4();
    serve(answer(DATA));
    const { user } = render('cmp=off');
    const list = await listOf();
    expect(screen.getByRole('radio', { name: 'Our rules' })).toBeChecked();
    expect(namesIn(list)).toEqual(['Gemini', 'ChatGPT', 'Claude', 'Copilot']);
    await user.click(screen.getByRole('radio', { name: 'GA4 channel' }));
    const byChannel = await listOf();
    expect(namesIn(byChannel)).toEqual(['Claude', 'ChatGPT', 'Gemini', 'Copilot']);
    expect(within(byChannel).getAllByRole('listitem')[0]?.textContent).toContain('160');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'AI referral visits by platform' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual([
      'Platform',
      'Visits, our rules',
      'Visits, GA4 channel',
      'Difference',
      'Engaged visits, our rules',
      'Engaged visits, GA4 channel',
    ]);
    const cells = (name: string): string[] =>
      within(within(table).getByRole('row', { name: new RegExp(name) }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? '');
    expect(cells('Gemini')).toEqual(['300', '50', '+250', '210', '35']);
    expect(cells('Claude')).toEqual(['40', '160', '−120', '28', '112']);
  });

  it('writes n/a, never 0, in the table for a classifier that has no row for a platform', async () => {
    linkGa4();
    serve(answer([row('grok', value(9, null), null)]));
    const { user } = render('cmp=off');
    await listOf();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'AI referral visits by platform' });
    const cells = within(within(table).getByRole('row', { name: /Grok/ }))
      .getAllByRole('cell')
      .map((cell) => cell.textContent ?? '');
    expect(cells).toEqual(['9', 'n/a', 'n/a', '6', 'n/a']);
  });

  it('leaves a platform whose count is unknown out of the bars, and writes n/a for it in the table, never 0', async () => {
    linkGa4();
    const unknown: Value = { sessions: null, engaged_sessions: null, key_events: null, previous: null };
    serve(answer([row('gemini', value(30, null), null), row('claude', unknown, null)]));
    const { user } = render('cmp=off');
    expect(namesIn(await listOf())).toEqual(['Gemini']);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'AI referral visits by platform' });
    const cells = within(within(table).getByRole('row', { name: /Claude/ }))
      .getAllByRole('cell')
      .map((cell) => cell.textContent ?? '');
    expect(cells.slice(0, 2)).toEqual(['n/a', 'n/a']);
  });

  it('says there were no visits when the whole period is collected and no platform has a row', async () => {
    linkGa4();
    serve(answer([], { compare_window: null }));
    render('cmp=off');
    expect(await screen.findByText('No visits from AI platforms in this period')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'AI referral visits by platform' })).not.toBeInTheDocument();
    expect(screen.queryByText('GA4 is connected, visits are not collected yet')).not.toBeInTheDocument();
  });

  it('says up to which day it is collected, and draws no zero, when the period runs past it with nothing yet', async () => {
    linkGa4();
    serve(answer([], { collected_through: '2026-11-05', window_collected: false, compare_window: null }));
    render('cmp=off');
    expect(await screen.findByText('Collected through Nov 5, 2026')).toBeInTheDocument();
    expect(screen.queryByText('No visits from AI platforms in this period')).not.toBeInTheDocument();
  });

  it('keeps the bars and says up to which day they are collected when the period runs past it', async () => {
    linkGa4();
    serve(answer(DATA, { collected_through: '2026-11-05', window_collected: false, compare_window: null }));
    render('cmp=off');
    const list = await listOf();
    expect(namesIn(list)).toHaveLength(4);
    expect(screen.getByText('Collected through Nov 5, 2026')).toBeInTheDocument();
  });

  it('shows the notes of the answer as the footnote, and the lower bound in them', async () => {
    linkGa4();
    serve(answer(DATA));
    render('cmp=off');
    await listOf();
    for (const note of NOTES) expect(screen.getAllByText(note).length).toBeGreaterThan(0);
  });

  it('draws five bars at most and says where the rest is', async () => {
    linkGa4();
    const many = Array.from({ length: 8 }, (_, index) =>
      row(`platform_${String(index)}`, value(80 - index, null), null),
    );
    serve(answer(many));
    render('cmp=off');
    const list = await listOf();
    expect(namesIn(list)).toHaveLength(5);
    expect(screen.getAllByText(/The top 5 of 8 platforms are drawn/).length).toBeGreaterThan(0);
  });

  it('says it could not load, and loads again with Try again', async () => {
    linkGa4();
    let calls = 0;
    server.use(
      http.get(ROUTE, ({ request }) => {
        calls += 1;
        return calls === 1 ? problem(request, 'internal_error') : HttpResponse.json(answer(DATA));
      }),
    );
    const { user } = render('cmp=off');
    expect((await screen.findAllByText('Could not load AI referral visits')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(namesIn(await listOf())).toHaveLength(4);
  });

  it('shows a skeleton while the visits load, then the bars', async () => {
    linkGa4();
    server.use(
      http.get(ROUTE, async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json(answer(DATA));
      }),
    );
    render('cmp=off');
    expect(await screen.findByRole('heading', { name: 'AI referral visits' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'AI referral visits by platform' })).not.toBeInTheDocument();
    expect(namesIn(await listOf())).toHaveLength(4);
  });

  it.each(['google_ai_mode', 'google_ai_overview'])(
    'keeps its place and says it is not measured on %s',
    async (engine) => {
      render(`cmp=off&engine=${engine}`);
      expect(await screen.findByRole('heading', { name: 'AI referral visits' })).toBeInTheDocument();
      expect(
        (
          await screen.findAllByText(
            /AI referral visits is not measured on .*Choose All platforms or another platform\./,
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByRole('link', { name: 'Connect GA4' })).not.toBeInTheDocument();
    },
  );

  it('has the preview info text and passes axe, with bars and without', async () => {
    const empty = render('cmp=off');
    await screen.findByText('GA4 is not connected');
    expect(screen.getByText(/Visits to your site that come from AI platforms\./)).toBeInTheDocument();
    expect(await axe(empty.container)).toHaveNoViolations();
    empty.unmount();
    linkGa4();
    serve(answer(DATA));
    const full = render('cmp=off');
    await listOf();
    expect(await axe(full.container)).toHaveNoViolations();
  });
});
