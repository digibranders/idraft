import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  });

  afterEach(() => {
    server.resetHandlers();
    server.events.removeAllListeners();
  });

  it('shows Tracked count, checked count, and Top 3, 10 and 20 under no filters', async () => {
    const activeCount = MOCK_TRACKED_KEYWORDS.filter((row) => row.is_active).length;
    const filters: KeywordFilters = { 'filter[is_active]': true };
    renderWithProviders(<RankStrip scope={SCOPE} filters={filters} total={activeCount} />);

    expect(await screen.findByText('Tracked')).toBeInTheDocument();
    expect(await screen.findByText(String(activeCount))).toBeInTheDocument();
    expect(screen.getByText('Top 3')).toBeInTheDocument();
    expect(screen.getByText('Top 10')).toBeInTheDocument();
    expect(screen.getByText('Top 20')).toBeInTheDocument();
    expect(await screen.findByText(/^\d+ checked$/)).toBeInTheDocument();
  });

  it('knows Top 3 is 0 without a request under rank=top10 filter', async () => {
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

    expect(await screen.findByText('Tracked')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Top 3')).toBeInTheDocument();
    });
    expect(asked.some((query) => query.includes('rank_lte=3'))).toBe(false);
  });

  it('shows error banner with Try again on failure', async () => {
    server.use(http.get(TRACKED_PATH, () => HttpResponse.json({ title: 'Server error' }, { status: 500 })));

    const { user } = renderWithProviders(
      <RankStrip scope={SCOPE} filters={{ 'filter[is_active]': true }} total={10} />,
    );

    expect(await screen.findByText('The summary did not load.')).toBeInTheDocument();
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    expect(tryAgain).toBeInTheDocument();

    const naElements = screen.getAllByText('n/a');
    expect(naElements.length).toBeGreaterThanOrEqual(4);

    server.resetHandlers();
    await user.click(tryAgain);
    expect(await screen.findByText(/^\d+ checked$/)).toBeInTheDocument();
  });
});
