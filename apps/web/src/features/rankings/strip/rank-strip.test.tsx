import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RankStrip } from './rank-strip';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { MOCK_TRACKED_KEYWORDS } from '@/mocks/keyword-fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/msw';
import type { KeywordFilters } from '../rankings-queries';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const TRACKED_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords');

describe('RankStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  });

  afterEach(() => {
    vi.useRealTimers();
    server.resetHandlers();
    server.events.removeAllListeners();
  });

  it('shows Keywords count, checked count, and Top 3, 10 and 20 under no filters', async () => {
    const activeCount = MOCK_TRACKED_KEYWORDS.filter((row) => row.is_active).length;
    const filters: KeywordFilters = { 'filter[is_active]': true };
    renderWithProviders(<RankStrip scope={SCOPE} filters={filters} total={activeCount} />);

    expect(await screen.findByText('Keywords')).toBeInTheDocument();
    expect(await screen.findByText(String(activeCount))).toBeInTheDocument();
    expect(await screen.findByText('55 checked')).toBeInTheDocument();
    expect(screen.getByText('Top 3')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Top 10')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Top 20')).toBeInTheDocument();
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getAllByText('of 55 checked')).toHaveLength(3);
  });

  it('reads the six counts in one request, and a count the filters rule out is 0', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.includes('/tracked-keywords') && url.searchParams.get('limit') === '1') {
        asked.push(url.search);
      }
    });

    const bucket: KeywordFilters = {
      'filter[is_active]': true,
      'filter[rank_gte]': 4,
      'filter[rank_lte]': 10,
    };
    renderWithProviders(<RankStrip scope={SCOPE} filters={bucket} total={5} />);

    expect(await screen.findByText('Keywords')).toBeInTheDocument();
    expect(await screen.findByText('Top 3')).toBeInTheDocument();
    // No keyword of the 4 to 10 bucket ranks in the top 3
    expect(await screen.findByText('0')).toBeInTheDocument();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('include=counts');
  });

  it('shows error banner with Try again on failure', async () => {
    server.use(http.get(TRACKED_PATH, () => HttpResponse.json({ title: 'Server error' }, { status: 500 })));

    const { user } = renderWithProviders(
      <RankStrip scope={SCOPE} filters={{ 'filter[is_active]': true }} total={10} />,
    );

    expect(await screen.findByText('The summary did not load.')).toBeInTheDocument();
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    expect(tryAgain).toBeInTheDocument();

    expect(screen.getByText('10')).toBeInTheDocument();
    const naElements = screen.getAllByText('n/a');
    expect(naElements).toHaveLength(3);

    server.resetHandlers();
    await user.click(tryAgain);
    expect(await screen.findByText(/^\d+ checked$/)).toBeInTheDocument();
  });
});
