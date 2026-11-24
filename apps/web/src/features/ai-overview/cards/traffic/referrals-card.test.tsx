import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReferralsCard from './referrals-card';
import { CardInfoProvider } from '@/components/app/chart/card-info';
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

describe('the AI referral visits card', () => {
  it('says GA4 is not connected, with the way to connect it, and draws no visit', async () => {
    render('cmp=off');
    expect(await screen.findByRole('heading', { name: 'AI referral visits' })).toBeInTheDocument();
    expect(await screen.findByText('GA4 is not connected')).toBeInTheDocument();
    const connect = screen.getByRole('link', { name: 'Connect GA4' });
    expect(connect.getAttribute('href')).toContain('/integrations');
    expect(screen.queryByText(/Sample/)).not.toBeInTheDocument();
    expect(screen.queryByText(/visits in 28 days/)).not.toBeInTheDocument();
  });

  it('says GA4 is connected, and offers no connect button, when the project has a live GA4 property', async () => {
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/integrations', () =>
        HttpResponse.json({
          data: [{ integration_id: 'i1', kind: 'ga4', status: 'active' }],
          page: { limit: 50, offset: 0, total: 1 },
        }),
      ),
    );
    render('cmp=off');
    expect(await screen.findByText('GA4 is connected, visits are not collected yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect GA4' })).not.toBeInTheDocument();
    expect(screen.queryByText('GA4 is not connected')).not.toBeInTheDocument();
  });

  it('keeps its place and says it is not measured on Google AI Mode', async () => {
    render('cmp=off&engine=google_ai_mode');
    expect(await screen.findByRole('heading', { name: 'AI referral visits' })).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/AI referral visits is not measured on .*Choose All platforms or another platform\./))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Connect GA4' })).not.toBeInTheDocument();
  });

  it('has the preview info text and passes axe', async () => {
    const { container } = render('cmp=off');
    await screen.findByText('GA4 is not connected');
    expect(screen.getByText(/Visits to your site that come from AI platforms\./)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
