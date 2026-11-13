import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { InSearch } from './in-search';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import { DRAWER_TOPIC_ID, renderDrawerPart } from '@/test/topic-drawer-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

const TRACKED_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords');

const page = (total: number) => ({ data: [], page: { has_more: false, limit: 1, next_cursor: null, total } });

/** The tracked keyword list answers `keywords` for the topic and `top10` when the places are cut at 10. */
function serve(keywords: number, top10: number, asked: URL[] = []): void {
  server.use(
    http.get(TRACKED_PATH, ({ request }) => {
      const url = new URL(request.url);
      asked.push(url);
      return HttpResponse.json(page(url.searchParams.has('filter[rank_lte]') ? top10 : keywords));
    }),
  );
}

describe('InSearch: the search counts of a topic', () => {
  it('reads the keywords and the Top 10 of the topic with limit=1 and filter[term]', async () => {
    const asked: URL[] = [];
    serve(12, 5, asked);
    renderDrawerPart(<InSearch />);
    await screen.findByText('12');
    expect(asked).toHaveLength(2);
    for (const url of asked) {
      expect(url.searchParams.get('filter[term]')).toBe(DRAWER_TOPIC_ID);
      expect(url.searchParams.get('limit')).toBe('1');
    }
    expect(asked.filter((url) => url.searchParams.get('filter[rank_lte]') === '10')).toHaveLength(1);
    expect(asked.filter((url) => !url.searchParams.has('filter[rank_lte]'))).toHaveLength(1);
  });

  it('says the counts with the keywords they are of', async () => {
    serve(12, 5);
    renderDrawerPart(<InSearch />);
    expect(screen.getByRole('heading', { name: 'In search' })).toBeInTheDocument();
    const keywords = (await screen.findByText('Keywords')).closest('div');
    expect(keywords).toHaveTextContent('12');
    expect(keywords).toHaveTextContent('tracked and given this topic');
    const top = screen.getByText('Top 10').closest('div');
    expect(top).toHaveTextContent('5');
    expect(top).toHaveTextContent('of 12 tracked');
  });

  it('says a Top 10 of 0 as a count, with the keywords it is of', async () => {
    serve(3, 0);
    renderDrawerPart(<InSearch />);
    const top = (await screen.findByText('Top 10')).closest('div');
    expect(top).toHaveTextContent('0');
    expect(top).toHaveTextContent('of 3 tracked');
  });

  it('says no tracked keyword is given this topic for a total of 0, and why', async () => {
    serve(0, 0);
    renderDrawerPart(<InSearch />);
    expect(await screen.findByRole('heading', { name: 'No tracked keyword is given this topic' })).toBeInTheDocument();
    expect(screen.getByText(/Tracked keywords carry their own topics/)).toBeInTheDocument();
    expect(screen.queryByText('Top 10')).not.toBeInTheDocument();
  });

  it('has an inline error with Retry that leaves the drawer intact', async () => {
    let fail = true;
    server.use(
      http.get(TRACKED_PATH, ({ request }) =>
        fail
          ? HttpResponse.json({ status: 500, code: 'internal_error', title: 'x' }, { status: 500 })
          : HttpResponse.json(page(new URL(request.url).searchParams.has('filter[rank_lte]') ? 2 : 7)),
      ),
    );
    const { user } = renderDrawerPart(
      <>
        <p>Other drawer content</p>
        <InSearch />
      </>,
    );
    expect(await screen.findByText('The search counts could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('Other drawer content')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.queryByText('The search counts could not be loaded')).not.toBeInTheDocument();
  });

  it('links to Rankings filtered to the topic', async () => {
    serve(4, 1);
    renderDrawerPart(<InSearch />);
    const link = await screen.findByRole('link', { name: 'Open in Rankings' });
    expect(link).toHaveAttribute('href', `/digibranders/fynix/seo/keywords?tag=${DRAWER_TOPIC_ID}`);
  });

  it('is not offered for No topic, and reads nothing for it', () => {
    const asked: URL[] = [];
    serve(4, 1, asked);
    renderDrawerPart(<InSearch />, { topicKey: NO_TOPIC });
    expect(screen.queryByRole('heading', { name: 'In search' })).not.toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });

  it('shows a skeleton while loading', async () => {
    server.use(http.get(TRACKED_PATH, () => new Promise<Response>(() => undefined)));
    renderDrawerPart(<InSearch />);
    expect(screen.getByRole('heading', { name: 'In search' }).closest('section')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(screen.queryByText('Keywords')).not.toBeInTheDocument());
  });
});
