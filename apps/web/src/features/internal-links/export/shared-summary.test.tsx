import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SharedSummary } from './shared-summary';
import { createShare } from '@/mocks/internal-links-shares-world';
import { RATE_LIMITED_TOKEN } from '@/mocks/internal-links-shares-world';
import { EVENTUS } from '@/mocks/internal-links-world';
import { mockUser } from '@/mocks/fixtures';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

afterEach(() => {
  server.events.removeAllListeners();
});

describe('the page a shared link opens', () => {
  it('shows the summary in a sandboxed frame with a title', async () => {
    const { token } = createShare(EVENTUS.project_id, mockUser('editor').user_id, 30);
    renderWithProviders(<SharedSummary token={token} />);
    const frame = await screen.findByTitle('Client summary of the internal links');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('eventussecurity.com');
  });

  it('says the link is no longer available for an unknown token, and offers no way into the app', async () => {
    renderWithProviders(<SharedSummary token="nothing-here" />);
    expect(await screen.findByRole('heading', { name: 'This link is no longer available' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('says to wait on a rate limit, with the time the API asked for, and can try again', async () => {
    renderWithProviders(<SharedSummary token={RATE_LIMITED_TOKEN} />);
    expect(await screen.findByRole('heading', { name: 'Too many requests' })).toBeInTheDocument();
    expect(screen.getByText('Try again in 2 minutes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
