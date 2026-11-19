import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  acceptSuggestionsMutation,
  cancelCrawlMutation,
  decideOpportunitiesMutation,
  dismissSuggestionsMutation,
  startCrawlMutation,
  updateSettingsMutation,
} from './mutations';
import { server } from '@/test/msw';

const path = { workspace_id: 'w1', project_id: 'p1' };
const client = (): QueryClient => new QueryClient();
const RUN = {
  run_id: '0192e4a0-9000-7000-8000-000000000002',
  state: 'queued',
};

describe('the crawl and settings writes (the backend OpenAPI)', () => {
  it('starts a crawl with a JSON body', async () => {
    let seen: { url: string; body: unknown } | null = null;
    server.use(
      http.post('*/api/v1/workspaces/:w/projects/:p/link-crawls', async ({ request }) => {
        seen = { url: new URL(request.url).pathname, body: await request.json() };
        return HttpResponse.json({ data: RUN }, { status: 202 });
      }),
    );
    const start = new MutationObserver(client(), startCrawlMutation);
    await start.mutate({ params: { path }, body: { higher_limit: false } });
    expect(seen).toEqual({ url: '/api/v1/workspaces/w1/projects/p1/link-crawls', body: { higher_limit: false } });
  });

  it('cancels a crawl by its run id', async () => {
    let url = '';
    server.use(
      http.post('*/api/v1/workspaces/:w/projects/:p/link-crawls/:run/cancel', ({ request }) => {
        url = new URL(request.url).pathname;
        return HttpResponse.json({ data: RUN });
      }),
    );
    const cancel = new MutationObserver(client(), cancelCrawlMutation);
    await cancel.mutate({ params: { path: { ...path, run_id: RUN.run_id } } });
    expect(url).toBe(`/api/v1/workspaces/w1/projects/p1/link-crawls/${RUN.run_id}/cancel`);
  });

  it('changes only the internal links part of the settings', async () => {
    let body: unknown = null;
    server.use(
      http.patch('*/api/v1/workspaces/:w/projects/:p/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { version: 1, entity_config_version: 1 } });
      }),
    );
    const update = new MutationObserver(client(), updateSettingsMutation);
    await update.mutate({ params: { path }, body: { internal_links: { schedule: 'monthly' } } });
    expect(body).toEqual({ internal_links: { schedule: 'monthly' } });
  });

  it('sends the alert rules inside the internal links part, with members left out kept as they are', async () => {
    let body: unknown = null;
    server.use(
      http.patch('*/api/v1/workspaces/:w/projects/:p/settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { version: 1, entity_config_version: 1 } });
      }),
    );
    const update = new MutationObserver(client(), updateSettingsMutation);
    await update.mutate({ params: { path }, body: { internal_links: { alerts: { threshold: 3 } } } });
    expect(body).toEqual({ internal_links: { alerts: { threshold: 3 } } });
  });
});

describe('the opportunity and tier suggestion writes (the backend OpenAPI)', () => {
  const BASE = '/api/v1/workspaces/w1/projects/p1/internal-links';

  it('puts the decision of opportunities with its status and pairs', async () => {
    let seen: { url: string; body: unknown } | null = null;
    server.use(
      http.put('*/api/v1/workspaces/:w/projects/:p/internal-links/opportunities/decisions', async ({ request }) => {
        seen = { url: new URL(request.url).pathname, body: await request.json() };
        return HttpResponse.json({ data: { matched: 1, changed: 1 } });
      }),
    );
    const decide = new MutationObserver(client(), decideOpportunitiesMutation);
    const body = { status: 'dismissed' as const, items: [{ source_url_id: '1', target_url_id: '2' }] };
    await decide.mutate({ params: { path }, body });
    expect(seen).toEqual({ url: `${BASE}/opportunities/decisions`, body });
  });

  it('posts the accepted and the dismissed suggestions with their selection', async () => {
    const seen: { url: string; body: unknown }[] = [];
    server.use(
      http.post('*/api/v1/workspaces/:w/projects/:p/internal-links/tier-suggestions/:action', async ({ request }) => {
        seen.push({ url: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json({ data: { matched: 2, changed: 2 } });
      }),
    );
    await new MutationObserver(client(), acceptSuggestionsMutation).mutate({
      params: { path },
      body: { url_ids: ['5', '6'] },
    });
    await new MutationObserver(client(), dismissSuggestionsMutation).mutate({
      params: { path },
      body: { all: true },
    });
    expect(seen).toEqual([
      { url: `${BASE}/tier-suggestions/accept`, body: { url_ids: ['5', '6'] } },
      { url: `${BASE}/tier-suggestions/dismiss`, body: { all: true } },
    ]);
  });
});
