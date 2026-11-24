import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GuestReport } from './guest-report';
import { createReportShare, RATE_LIMITED_REPORT_TOKEN } from '@/mocks/reports-world';
import { EVENTUS } from '@/mocks/internal-links-world';
import { mockUser } from '@/mocks/fixtures';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

afterEach(() => {
  server.events.removeAllListeners();
});

describe('the page a report link opens', () => {
  it('shows every percent with its counts, and the share of voice as brand mentions', async () => {
    const { token } = createReportShare(EVENTUS.project_id, mockUser('editor').user_id, 30);
    renderWithProviders(<GuestReport token={token} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'AI visibility report for eventussecurity.com' }),
    ).toBeInTheDocument();
    const numbers = screen.getByRole('table', { name: 'Mention rate, Citation rate and Share of voice' });
    const chatgpt = within(numbers).getByRole('row', { name: /ChatGPT/ });
    expect(within(chatgpt).getByText(/\(71 of 192 answers\)/)).toBeInTheDocument();
    expect(within(chatgpt).getByText(/\(38 of 192 answers\)/)).toBeInTheDocument();
    // 71 own mentions of 71 + 96 + 47 tracked-brand mentions
    expect(within(chatgpt).getByText(/\(71 of 214 brand mentions\)/)).toBeInTheDocument();
  });

  it('names the brands and the cited domains, and holds no costs and no way into the app', async () => {
    const { token } = createReportShare(EVENTUS.project_id, mockUser('editor').user_id, 30);
    renderWithProviders(<GuestReport token={token} />);

    const brands = await screen.findByRole('table', { name: 'Your brand and its competitors' });
    expect(within(brands).getByText('Eventus Security')).toBeInTheDocument();
    expect(within(brands).getAllByText('Competitor')).toHaveLength(2);
    const domains = screen.getByRole('table', { name: 'Cited domains' });
    expect(within(domains).getByText('gartner.com')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cost|budget|spend/i);
  });

  it('says the link is no longer available for an unknown token', async () => {
    renderWithProviders(<GuestReport token="nothing-here" />);
    expect(await screen.findByRole('heading', { name: 'This link is no longer available' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says to wait on a rate limit, with the time the API asked for', async () => {
    renderWithProviders(<GuestReport token={RATE_LIMITED_REPORT_TOKEN} />);
    expect(await screen.findByRole('heading', { name: 'Too many requests' })).toBeInTheDocument();
    expect(screen.getByText('Try again in 2 minutes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
